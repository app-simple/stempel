import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { fromLocalDate } from '../common/dates';
import { testPushKeys } from '../../testing/fakes';
import { SoftAuthenticator } from '../../testing/soft-authenticator';
import {
  createTestApp,
  http,
  ORIGIN,
  resetDb,
  sessionCookie,
  type TestContext,
} from '../../testing/test-app';

/**
 * Zugriffsmatrix (CLAUDE.md: zu jeder Route ein Test mit falscher Rolle; Spezifikation Abschnitt 7 und 8).
 *
 * Akteure: anonym, Mitarbeiter (empA1), Vorgesetzte A (Ziel ist in ihrem Team), Vorgesetzter B
 * (anderes Team) und Admin. Ziel der Routen mit :id ist empA2 aus Team A, also nie die anfragende Person.
 */
type Actor = 'anon' | 'employee' | 'lead' | 'otherLead' | 'admin';
type Expect = Record<Actor, number>;

interface Fixture {
  ids: Record<'admin' | 'leadA' | 'leadB' | 'empA1' | 'empA2' | 'empB1', string>;
  futureTermsId: string;
  holidayId: string;
  foreignPasskeyId: string;
  year: number;
  /** Buchung von empA2 mit offenem Korrekturantrag von empA2 */
  entryId: string;
  correctionId: string;
  /** Offener Urlaubsantrag von empA2 */
  leaveId: string;
  /** Genehmigter Urlaub von empA2 mit erbetener Stornierung */
  cancelLeaveId: string;
  /** Urlaubshinweis an empA2 */
  noticeId: string;
  /** Push-Gerät von empA2 */
  pushSubscriptionId: string;
  /** Krankmeldung von empA2 */
  sickLeaveId: string;
  /** Schulferien (Phase 7) */
  schoolHolidayId: string;
}

interface RouteCase {
  path: (f: Fixture) => string;
  body?: (f: Fixture) => object;
  expect: Expect;
  /**
   * Frische Testdaten je Akteur. Nötig, wenn mehrere Rollen erfolgreich schreiben und sich sonst
   * gegenseitig beeinflussen würden (z. B. zweiter Nachtrag überschneidet sich, Antrag schon entschieden).
   */
  fresh?: boolean;
}

const all = (status: number): Expect => ({
  anon: status,
  employee: status,
  lead: status,
  otherLead: status,
  admin: status,
});
const signedIn = (status: number): Expect => ({ ...all(status), anon: 401 });
const adminOnly = (status: number): Expect => ({
  anon: 401,
  employee: 403,
  lead: 403,
  otherLead: 403,
  admin: status,
});
const teamRead: Expect = { anon: 401, employee: 403, lead: 200, otherLead: 404, admin: 200 };
/** Zeitdaten anderer: Mitarbeiter haben keine Rolle-Sperre, der zentrale Filter ergibt 404. */
const teamTime = (status: number): Expect => ({
  anon: 401,
  employee: 404,
  lead: status,
  otherLead: 404,
  admin: status,
});
const span = {
  start: '08:00',
  end: '16:00',
  breaks: [{ start: '12:00', end: '12:30' }],
  reason: 'Matrix',
};

/** Gleiche Schlüssel für alle Akteure: derselbe Browser darf den Endpunkt übernehmen. */
const MATRIX_PUSH_KEYS = testPushKeys();
const leaveBody = (from: string, to: string) => ({
  type: 'VACATION',
  from,
  to,
  startHalf: false,
  endHalf: false,
});
const termsBody = (validFrom: string) => ({
  validFrom,
  type: 'FULL_TIME',
  weeklyMinutes: 2400,
  workDays: [1, 2, 3, 4, 5],
  annualLeaveDays: 30,
  extraLeaveDays: 0,
  hourlyWageCents: null,
});

export const ACCESS_MATRIX: Record<string, RouteCase> = {
  'GET /api/health': { path: () => '/api/health', expect: all(200) },
  'POST /api/auth/code/request': {
    fresh: true,
    path: () => '/api/auth/code/request',
    body: () => ({ email: 'x@example.com' }),
    expect: all(202),
  },
  'POST /api/auth/code/verify': {
    path: () => '/api/auth/code/verify',
    body: () => ({ email: 'x@example.com', code: '123456' }),
    expect: all(401),
  },
  'POST /api/auth/passkey/options': { path: () => '/api/auth/passkey/options', expect: all(200) },
  'POST /api/auth/passkey/verify': {
    path: () => '/api/auth/passkey/verify',
    body: () => ({}),
    expect: all(400),
  },
  'GET /api/auth/session': { path: () => '/api/auth/session', expect: signedIn(200) },
  'POST /api/auth/logout': { path: () => '/api/auth/logout', expect: signedIn(204) },
  'POST /api/auth/logout-all': { path: () => '/api/auth/logout-all', expect: signedIn(204) },
  'GET /api/me': { path: () => '/api/me', expect: signedIn(200) },
  'GET /api/me/passkeys': { path: () => '/api/me/passkeys', expect: signedIn(200) },
  'POST /api/me/passkeys/registration/options': {
    path: () => '/api/me/passkeys/registration/options',
    expect: signedIn(200),
  },
  'POST /api/me/passkeys/registration/verify': {
    path: () => '/api/me/passkeys/registration/verify',
    body: () => ({ name: 'x' }),
    expect: signedIn(400),
  },
  // Fremde Passkeys sind für alle unsichtbar, auch für den Admin.
  'PATCH /api/me/passkeys/:id': {
    path: (f) => `/api/me/passkeys/${f.foreignPasskeyId}`,
    body: () => ({ name: 'x' }),
    expect: signedIn(404),
  },
  'DELETE /api/me/passkeys/:id': {
    path: (f) => `/api/me/passkeys/${f.foreignPasskeyId}`,
    expect: signedIn(404),
  },
  'GET /api/employees': { path: () => '/api/employees', expect: { ...teamRead, otherLead: 200 } },
  'GET /api/employees/:id': { path: (f) => `/api/employees/${f.ids.empA2}`, expect: teamRead },
  'POST /api/employees': {
    path: () => '/api/employees',
    body: (f) => ({
      name: 'Neu',
      jobTitle: null,
      role: 'EMPLOYEE',
      loginEmail: 'neu@example.com',
      leadId: f.ids.leadA,
      deputyId: null,
      entryDate: '2026-01-01',
      exitDate: null,
      terms: termsBody('2026-01-01'),
      carryOverDays: 0,
    }),
    expect: adminOnly(201),
  },
  'PATCH /api/employees/:id': {
    path: (f) => `/api/employees/${f.ids.empA2}`,
    body: () => ({ jobTitle: 'Neu' }),
    expect: adminOnly(200),
  },
  'POST /api/employees/:id/lock': {
    path: (f) => `/api/employees/${f.ids.empA2}/lock`,
    expect: adminOnly(200),
  },
  'POST /api/employees/:id/unlock': {
    path: (f) => `/api/employees/${f.ids.empA2}/unlock`,
    expect: adminOnly(200),
  },
  'PUT /api/employees/:id/carry-over/:year': {
    path: (f) => `/api/employees/${f.ids.empA2}/carry-over/${f.year}`,
    body: () => ({ days: 3 }),
    expect: adminOnly(200),
  },
  'GET /api/employees/:id/terms': {
    path: (f) => `/api/employees/${f.ids.empA2}/terms`,
    expect: teamRead,
  },
  'POST /api/employees/:id/terms': {
    path: (f) => `/api/employees/${f.ids.empA2}/terms`,
    body: () => termsBody('2026-07-01'),
    expect: adminOnly(201),
  },
  'PATCH /api/employees/:id/terms/:termsId': {
    path: (f) => `/api/employees/${f.ids.empA2}/terms/${f.futureTermsId}`,
    body: () => termsBody('2027-02-01'),
    expect: adminOnly(200),
  },
  'DELETE /api/employees/:id/terms/:termsId': {
    path: (f) => `/api/employees/${f.ids.empA2}/terms/${f.futureTermsId}`,
    expect: adminOnly(204),
  },
  'GET /api/legal-parameters': { path: () => '/api/legal-parameters', expect: signedIn(200) },
  'GET /api/holidays': { path: (f) => `/api/holidays?year=${f.year}`, expect: signedIn(200) },
  'POST /api/holidays': {
    path: () => '/api/holidays',
    body: (f) => ({ date: `${f.year}-12-24`, name: 'Heiligabend (betrieblich)' }),
    expect: adminOnly(201),
  },
  'PATCH /api/holidays/:id': {
    path: (f) => `/api/holidays/${f.holidayId}`,
    body: () => ({ name: 'Umbenannt' }),
    expect: adminOnly(200),
  },
  'DELETE /api/holidays/:id': {
    path: (f) => `/api/holidays/${f.holidayId}`,
    expect: adminOnly(204),
  },
  'GET /api/settings/company': { path: () => '/api/settings/company', expect: signedIn(200) },
  'PATCH /api/settings/company': {
    path: () => '/api/settings/company',
    body: () => ({ assumptionDayIsHoliday: false }),
    expect: adminOnly(200),
  },
  'GET /api/audit-log': { path: () => '/api/audit-log', expect: adminOnly(200) },

  // Phase 2: Zeiterfassung
  'GET /api/time/today': { path: () => '/api/time/today', expect: signedIn(200) },
  'POST /api/time/clock/in': { path: () => '/api/time/clock/in', expect: signedIn(200) },
  'POST /api/time/clock/break-start': {
    path: () => '/api/time/clock/break-start',
    expect: signedIn(409),
  },
  'POST /api/time/clock/break-end': {
    path: () => '/api/time/clock/break-end',
    expect: signedIn(409),
  },
  'POST /api/time/clock/out': { path: () => '/api/time/clock/out', expect: signedIn(409) },
  'GET /api/time/week': {
    path: (f) => `/api/time/week?employeeId=${f.ids.empA2}&week=2026-W41`,
    expect: teamTime(200),
  },
  'GET /api/time/month': {
    path: (f) => `/api/time/month?employeeId=${f.ids.empA2}&month=2026-10`,
    expect: teamTime(200),
  },
  'GET /api/time/team-today': {
    path: () => '/api/time/team-today',
    expect: { ...teamRead, otherLead: 200 },
  },
  'POST /api/time/entries': {
    fresh: true,
    path: () => '/api/time/entries',
    body: (f) => ({ ...span, employeeId: f.ids.empA2, date: '2026-10-09' }),
    expect: teamTime(201),
  },
  'POST /api/time/entries/:id/correct': {
    fresh: true,
    path: (f) => `/api/time/entries/${f.entryId}/correct`,
    body: () => ({ ...span, start: '07:30' }),
    expect: teamTime(200),
  },
  'POST /api/time/entries/:id/void': {
    fresh: true,
    path: (f) => `/api/time/entries/${f.entryId}/void`,
    body: () => ({ reason: 'Matrix' }),
    expect: teamTime(200),
  },
  'GET /api/time/entries/:id/revisions': {
    path: (f) => `/api/time/entries/${f.entryId}/revisions`,
    expect: teamTime(200),
  },
  'GET /api/time/corrections': { path: () => '/api/time/corrections', expect: signedIn(200) },
  'POST /api/time/corrections/:id/approve': {
    fresh: true,
    path: (f) => `/api/time/corrections/${f.correctionId}/approve`,
    // Ohne Rollensperre: Vertretungen dürfen entscheiden (Phase 3); fremde Anträge sind 404.
    expect: teamTime(200),
  },
  'POST /api/time/corrections/:id/reject': {
    fresh: true,
    path: (f) => `/api/time/corrections/${f.correctionId}/reject`,
    body: () => ({ reason: 'Matrix' }),
    // Ohne Rollensperre: Vertretungen dürfen entscheiden (Phase 3); fremde Anträge sind 404.
    expect: teamTime(200),
  },
  // Zurückziehen darf nur, wer den Antrag gestellt hat (empA2) – für alle anderen unsichtbar.
  'POST /api/time/corrections/:id/withdraw': {
    path: (f) => `/api/time/corrections/${f.correctionId}/withdraw`,
    expect: signedIn(404),
  },
  'GET /api/time/months': { path: () => '/api/time/months', expect: signedIn(200) },
  'POST /api/time/months/:month/close': {
    path: () => '/api/time/months/2026-08/close',
    expect: signedIn(200),
  },
  'POST /api/time/months/:employeeId/:month/reopen': {
    path: (f) => `/api/time/months/${f.ids.empA2}/2026-09/reopen`,
    expect: adminOnly(200),
  },
  'GET /api/time/overtime': {
    path: (f) => `/api/time/overtime?employeeId=${f.ids.empA2}`,
    expect: teamTime(200),
  },
  'PUT /api/employees/:id/overtime-account': {
    path: (f) => `/api/employees/${f.ids.empA2}/overtime-account`,
    body: () => ({ since: '2026-10-01' }),
    expect: adminOnly(200),
  },
  'POST /api/employees/:id/overtime-adjustments': {
    path: (f) => `/api/employees/${f.ids.empA2}/overtime-adjustments`,
    body: () => ({ minutes: 60, effectiveOn: '2026-10-01', reason: 'Übernahme Altsaldo' }),
    expect: adminOnly(201),
  },

  // Phase 3: Abwesenheiten. Fremde Anträge und Konten sind außerhalb des Sichtbereichs 404.
  'POST /api/leave/preview': {
    path: () => '/api/leave/preview',
    body: () => leaveBody('2026-11-16', '2026-11-17'),
    expect: signedIn(200),
  },
  'POST /api/leave/requests': {
    fresh: true,
    path: () => '/api/leave/requests',
    body: (f) => ({ ...leaveBody('2026-11-16', '2026-11-17'), employeeId: f.ids.empA2 }),
    expect: teamTime(201),
  },
  'GET /api/leave/requests': { path: () => '/api/leave/requests', expect: signedIn(200) },
  // Zurückziehen und Stornierung erbitten nur die Person selbst (empA2).
  'POST /api/leave/requests/:id/withdraw': {
    path: (f) => `/api/leave/requests/${f.leaveId}/withdraw`,
    expect: signedIn(404),
  },
  'POST /api/leave/requests/:id/approve': {
    fresh: true,
    path: (f) => `/api/leave/requests/${f.leaveId}/approve`,
    expect: teamTime(200),
  },
  'POST /api/leave/requests/:id/reject': {
    fresh: true,
    path: (f) => `/api/leave/requests/${f.leaveId}/reject`,
    body: () => ({ reason: 'Matrix: betrieblicher Grund' }),
    expect: teamTime(200),
  },
  'POST /api/leave/requests/:id/cancellation': {
    path: (f) => `/api/leave/requests/${f.leaveId}/cancellation`,
    expect: signedIn(404),
  },
  'POST /api/leave/requests/:id/cancellation/approve': {
    fresh: true,
    path: (f) => `/api/leave/requests/${f.cancelLeaveId}/cancellation/approve`,
    expect: teamTime(200),
  },
  'POST /api/leave/requests/:id/cancellation/reject': {
    fresh: true,
    path: (f) => `/api/leave/requests/${f.cancelLeaveId}/cancellation/reject`,
    expect: teamTime(200),
  },
  'GET /api/leave/account': {
    path: (f) => `/api/leave/account?employeeId=${f.ids.empA2}&year=2026`,
    expect: teamTime(200),
  },
  'GET /api/leave/accounts': {
    path: () => '/api/leave/accounts?year=2026',
    expect: { ...teamRead, otherLead: 200 },
  },
  'GET /api/leave/calendar': {
    path: () => '/api/leave/calendar?month=2026-11',
    expect: signedIn(200),
  },
  'GET /api/employees/:id/leave-ledger': {
    path: (f) => `/api/employees/${f.ids.empA2}/leave-ledger`,
    expect: adminOnly(200),
  },
  'POST /api/employees/:id/leave-ledger': {
    path: (f) => `/api/employees/${f.ids.empA2}/leave-ledger`,
    body: () => ({ year: 2026, halfDays: 2, note: 'Matrix' }),
    expect: adminOnly(201),
  },

  // Phase 4: Prüfungen und Nachweise
  'GET /api/checks': { path: () => '/api/checks', expect: { ...teamRead, otherLead: 200 } },
  'GET /api/leave/notices': { path: () => '/api/leave/notices', expect: signedIn(200) },
  'POST /api/leave/notices': {
    path: () => '/api/leave/notices',
    body: (f) => ({ year: 2026, employeeIds: [f.ids.empA2] }),
    expect: adminOnly(201),
  },
  // Lesebestätigung nur durch die Person selbst (empA2).
  'POST /api/leave/notices/:id/read': {
    path: (f) => `/api/leave/notices/${f.noticeId}/read`,
    expect: signedIn(404),
  },
  // Vor dem Verfallstag lehnt die API fachlich ab; Rollenfehler vorher mit 403.
  'POST /api/leave/forfeitures': {
    path: () => '/api/leave/forfeitures',
    body: (f) => ({ employeeId: f.ids.empA2, year: 2026, kind: 'YEAR_END' }),
    expect: adminOnly(422),
  },
  'GET /api/exports/time': {
    path: (f) => `/api/exports/time?month=2026-10&format=csv&employeeId=${f.ids.empA2}`,
    expect: teamTime(200),
  },
  'GET /api/exports/month': {
    path: () => '/api/exports/month?month=2026-10',
    expect: adminOnly(200),
  },
  // Phase 5: Erinnerungen und Nachträge
  'GET /api/reminders/today': { path: () => '/api/reminders/today', expect: signedIn(200) },
  'POST /api/reminders/mute': { path: () => '/api/reminders/mute', expect: signedIn(204) },
  'GET /api/push/public-key': { path: () => '/api/push/public-key', expect: signedIn(200) },
  'GET /api/me/push-subscriptions': {
    path: () => '/api/me/push-subscriptions',
    expect: signedIn(200),
  },
  'POST /api/me/push-subscriptions': {
    path: () => '/api/me/push-subscriptions',
    body: () => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/matrix',
      keys: MATRIX_PUSH_KEYS,
      deviceName: 'Matrix',
    }),
    expect: signedIn(201),
  },
  'POST /api/me/push-subscriptions/test': {
    path: () => '/api/me/push-subscriptions/test',
    expect: signedIn(200),
  },
  // Fremde Geräte sind für alle unsichtbar, auch für den Admin.
  'DELETE /api/me/push-subscriptions/:id': {
    path: (f) => `/api/me/push-subscriptions/${f.pushSubscriptionId}`,
    expect: signedIn(404),
  },
  'PATCH /api/me/reminder-settings': {
    path: () => '/api/me/reminder-settings',
    body: () => ({ emailFallback: false }),
    expect: signedIn(200),
  },
  'GET /api/checks/late-entries': {
    path: () => '/api/checks/late-entries',
    expect: { ...teamRead, otherLead: 200 },
  },
  'GET /api/time/late-entries': { path: () => '/api/time/late-entries', expect: signedIn(200) },
  'GET /api/settings/reminders': { path: () => '/api/settings/reminders', expect: adminOnly(200) },
  'PUT /api/settings/reminders': {
    path: () => '/api/settings/reminders',
    body: () => ({
      defaultStart: '08:00',
      lateFlagMinCount: 3,
      lateFlagMinPercent: 20,
      lateFlagWeeks: 6,
    }),
    expect: adminOnly(200),
  },
  // Phase 6: Krankmeldungen. Mitarbeiter sehen Kollegen nicht (404), Vorgesetzte nur ihr Team.
  'GET /api/sick': { path: () => '/api/sick', expect: signedIn(200) },
  'GET /api/checks/sick': {
    path: () => '/api/checks/sick',
    expect: { ...teamRead, otherLead: 200 },
  },
  'POST /api/sick': {
    fresh: true,
    path: () => '/api/sick',
    body: (f) => ({ employeeId: f.ids.empA2, kind: 'SICK', from: '2026-11-16', to: '2026-11-17' }),
    expect: teamTime(201),
  },
  'PATCH /api/sick/:id': {
    path: (f) => `/api/sick/${f.sickLeaveId}`,
    body: () => ({ to: '2026-11-11' }),
    expect: teamTime(200),
  },
  'PUT /api/sick/:id/certificate': {
    path: (f) => `/api/sick/${f.sickLeaveId}/certificate`,
    body: () => ({ until: '2026-11-10' }),
    expect: teamTime(200),
  },
  'DELETE /api/sick/:id': {
    fresh: true,
    path: (f) => `/api/sick/${f.sickLeaveId}`,
    body: () => ({ reason: 'Matrix' }),
    expect: { anon: 401, employee: 404, lead: 403, otherLead: 404, admin: 204 },
  },
  'PATCH /api/employees/:id/certificate-from-day1': {
    path: (f) => `/api/employees/${f.ids.empA2}/certificate-from-day1`,
    body: () => ({ value: true }),
    expect: adminOnly(200),
  },
  // Phase 7: Schulferien. Lesen für alle Angemeldeten, Pflege nur Admin.
  'GET /api/school-holidays': {
    path: () => '/api/school-holidays?year=2026',
    expect: signedIn(200),
  },
  'POST /api/school-holidays': {
    fresh: true,
    path: () => '/api/school-holidays',
    body: () => ({ name: 'Matrix', from: '2026-12-21', to: '2026-12-23' }),
    expect: adminOnly(201),
  },
  'PATCH /api/school-holidays/:id': {
    path: (f) => `/api/school-holidays/${f.schoolHolidayId}`,
    body: () => ({ active: false }),
    expect: adminOnly(200),
  },
  'DELETE /api/school-holidays/:id': {
    fresh: true,
    path: (f) => `/api/school-holidays/${f.schoolHolidayId}`,
    expect: adminOnly(204),
  },
  'GET /api/settings/retention': { path: () => '/api/settings/retention', expect: adminOnly(200) },
  'PUT /api/settings/retention': {
    path: () => '/api/settings/retention',
    body: () => ({ enabled: false, timeYears: 2, payrollYears: 8, leaveYears: 3, auditYears: 3 }),
    expect: adminOnly(200),
  },
};

/** Alle Routen, die Nest tatsächlich registriert hat. */
function registeredRoutes(ctx: TestContext): string[] {
  const routes: string[] = [];
  for (const module of ctx.app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => unknown) | null;
      if (!controller) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = (controller.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (path === undefined || method === undefined) continue;
        const full = ['api', base, path]
          .map((p) => p.replace(/^\/|\/$/g, ''))
          .filter(Boolean)
          .join('/');
        routes.push(`${RequestMethod[method]} /${full}`);
      }
    }
  }
  return routes.sort();
}

async function createFixture(ctx: TestContext): Promise<Fixture> {
  const { prisma } = ctx;
  await prisma.legalParameter.createMany({
    data: [
      {
        key: 'MIN_WAGE_HOURLY_CENTS',
        value: 1390,
        validFrom: fromLocalDate('2026-01-01'),
        source: 'Test',
      },
      {
        key: 'MINIJOB_MONTHLY_LIMIT_CENTS',
        value: 60300,
        validFrom: fromLocalDate('2026-01-01'),
        source: 'Test',
      },
      {
        key: 'MIN_WAGE_HOURLY_CENTS',
        value: 1460,
        validFrom: fromLocalDate('2027-01-01'),
        source: 'Test',
      },
      {
        key: 'MINIJOB_MONTHLY_LIMIT_CENTS',
        value: 63300,
        validFrom: fromLocalDate('2027-01-01'),
        source: 'Test',
      },
    ],
  });
  const terms = {
    validFrom: fromLocalDate('2026-01-01'),
    type: 'FULL_TIME' as const,
    weeklyMinutes: 2400,
    workDays: [1, 2, 3, 4, 5],
    annualLeaveDays: 30,
  };
  const make = async (key: string, role: 'ADMIN' | 'LEAD' | 'EMPLOYEE', leadId: string | null) =>
    (
      await prisma.employee.create({
        data: {
          name: key,
          loginEmail: `${key.toLowerCase()}@example.com`,
          role,
          leadId,
          entryDate: fromLocalDate('2026-01-01'),
          terms: { create: terms },
        },
      })
    ).id;
  const admin = await make('Admin', 'ADMIN', null);
  const leadA = await make('LeadA', 'LEAD', admin);
  const leadB = await make('LeadB', 'LEAD', admin);
  const empA1 = await make('EmpA1', 'EMPLOYEE', leadA);
  const empA2 = await make('EmpA2', 'EMPLOYEE', leadA);
  const empB1 = await make('EmpB1', 'EMPLOYEE', leadB);
  const future = await prisma.employmentTerms.create({
    data: { ...terms, validFrom: fromLocalDate('2027-01-01'), employeeId: empA2 },
  });
  const year = Number(ctx.clock.today().slice(0, 4));
  const holiday = await prisma.holiday.create({
    data: { date: fromLocalDate(`${year}-11-11`), name: 'Betriebsfeier', origin: 'MANUAL' },
  });

  const authenticator = new SoftAuthenticator('localhost', ORIGIN);
  const cookie = await sessionCookie(ctx, empA2);
  const options = await http(ctx)
    .post('/api/me/passkeys/registration/options')
    .set('Origin', ORIGIN)
    .set('Cookie', cookie)
    .expect(200);
  const passkey = await http(ctx)
    .post('/api/me/passkeys/registration/verify')
    .set('Origin', ORIGIN)
    .set('Cookie', cookie)
    .send({ response: authenticator.register(options.body), name: 'Fremd' })
    .expect(201);

  // Buchung von empA2 am 07.10. mit offenem Korrekturantrag, abgeschlossener September, Überstundenkonto
  const entry = await http(ctx)
    .post('/api/time/entries')
    .set('Origin', ORIGIN)
    .set('Cookie', cookie)
    .send({ ...span, date: '2026-10-07', reason: 'Stempeln vergessen' })
    .expect(201);
  const correction = await http(ctx)
    .post(`/api/time/entries/${entry.body.entry.id}/correct`)
    .set('Origin', ORIGIN)
    .set('Cookie', cookie)
    .send({ ...span, end: '17:00', reason: 'Länger gearbeitet' })
    .expect(200);
  await prisma.monthClosing.create({
    data: { employeeId: empA2, month: '2026-09', confirmedAt: new Date() },
  });
  await prisma.employee.update({
    where: { id: empA2 },
    data: { overtimeAccountSince: fromLocalDate('2026-10-01') },
  });

  const leave = (from: string, to: string) => ({
    employeeId: empA2,
    type: 'VACATION' as const,
    from: fromLocalDate(from),
    to: fromLocalDate(to),
    halfDays: 10,
    requestedAt: new Date(),
    requestedById: empA2,
  });
  const pendingLeave = await prisma.leaveRequest.create({
    data: leave('2026-11-02', '2026-11-06'),
  });
  const cancelLeave = await prisma.leaveRequest.create({
    data: {
      ...leave('2026-12-01', '2026-12-04'),
      status: 'APPROVED',
      decidedAt: new Date(),
      decidedById: leadA,
      cancelRequestedAt: new Date(),
    },
  });

  const notice = await prisma.leaveNotice.create({
    data: {
      employeeId: empA2,
      year: 2026,
      restHalfDays: 10,
      text: 'Matrix',
      sentAt: new Date(),
      sentById: admin,
    },
  });

  const pushSubscription = await prisma.pushSubscription.create({
    data: {
      employeeId: empA2,
      endpoint: 'https://fcm.googleapis.com/fcm/send/empA2',
      p256dh: 'p256dh',
      auth: 'auth',
      deviceName: 'Fremdes Gerät',
    },
  });

  const sickLeave = await prisma.sickLeave.create({
    data: {
      employeeId: empA2,
      kind: 'SICK',
      from: fromLocalDate('2026-11-09'),
      to: fromLocalDate('2026-11-10'),
      reportedAt: new Date(),
      reportedById: empA2,
    },
  });

  const schoolHoliday = await prisma.schoolHoliday.create({
    data: {
      name: 'Herbstferien',
      from: fromLocalDate('2026-11-02'),
      to: fromLocalDate('2026-11-06'),
    },
  });

  return {
    schoolHolidayId: schoolHoliday.id,
    sickLeaveId: sickLeave.id,
    pushSubscriptionId: pushSubscription.id,
    noticeId: notice.id,
    leaveId: pendingLeave.id,
    cancelLeaveId: cancelLeave.id,
    ids: { admin, leadA, leadB, empA1, empA2, empB1 },
    futureTermsId: future.id,
    holidayId: holiday.id,
    foreignPasskeyId: passkey.body.id as string,
    year,
    entryId: entry.body.entry.id as string,
    correctionId: correction.body.request.id as string,
  };
}

describe('Zugriffsmatrix', () => {
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());

  it('deckt jede registrierte Route ab', () => {
    expect(registeredRoutes(ctx)).toEqual(Object.keys(ACCESS_MATRIX).sort());
  });

  const actorId: Record<Exclude<Actor, 'anon'>, keyof Fixture['ids']> = {
    employee: 'empA1',
    lead: 'leadA',
    otherLead: 'leadB',
    admin: 'admin',
  };

  // Testdaten je Route einmal aufbauen; nur bei `fresh` je Akteur neu (hält die Laufzeit in Grenzen).
  let current: { route: string; fixture: Fixture } | null = null;
  async function fixtureFor(route: string, fresh: boolean): Promise<Fixture> {
    if (!fresh && current?.route === route) return current.fixture;
    await resetDb(ctx.prisma);
    ctx.clock.set('2026-10-12T08:00:00.000Z');
    current = { route, fixture: await createFixture(ctx) };
    return current.fixture;
  }

  for (const [route, rc] of Object.entries(ACCESS_MATRIX)) {
    for (const actor of Object.keys(rc.expect) as Actor[]) {
      it(`${route} als ${actor} → ${rc.expect[actor]}`, async () => {
        const fixture = await fixtureFor(route, rc.fresh ?? false);
        const method = route.split(' ')[0]?.toLowerCase() as
          'get' | 'post' | 'patch' | 'put' | 'delete';
        let req = http(ctx)
          [method](rc.path(fixture))
          .set('Origin', ORIGIN)
          .set('X-Forwarded-For', `10.9.${Math.floor(Math.random() * 250)}.1`);
        if (actor !== 'anon')
          req = req.set('Cookie', await sessionCookie(ctx, fixture.ids[actorId[actor]]));
        const res = rc.body ? await req.send(rc.body(fixture)) : await req;
        expect({ route, actor, status: res.status }).toEqual({
          route,
          actor,
          status: rc.expect[actor],
        });
      });
    }
  }
});
