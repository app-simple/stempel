import type {
  CorrectionRequestView,
  OvertimeView,
  TeamTodayRow,
  WeekView,
  LeaveAccountView,
  LeaveCalendarView,
  LeavePreview,
  LeaveRequestView,
} from '@as/shared';
import { fromLocalDate } from '../common/dates';
import { AuditService } from '../audit/audit.service';
import { LeaveOverdueService } from './leave-overdue.service';
import {
  createEmployee,
  createTestApp,
  http,
  ORIGIN,
  resetDb,
  seedLegalParameters,
  sessionCookie,
  type TestContext,
} from '../../testing/test-app';

/**
 * Abwesenheiten (Spezifikation Phase 3). Heute ist Montag, 12.10.2026. Testpersonen: Vollzeit Mo–Fr,
 * 30 Tage Jahresurlaub, Eintritt 01.01.2026 (Anspruch 2026 = 60 halbe Tage).
 */
describe('Abwesenheiten', () => {
  let ctx: TestContext;
  type Person = { id: string; email: string; cookie: string };
  let admin: Person;
  let lead: Person;
  let emp: Person;
  let peer: Person;
  let otherLead: Person;
  let otherEmp: Person;

  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.clock.set('2026-10-12T08:00:00.000Z');
    ctx.mail.sent.length = 0;
    await seedLegalParameters(ctx.prisma);
    const person = async (seed: Parameters<typeof createEmployee>[1]): Promise<Person> => {
      const p = await createEmployee(ctx.prisma, seed);
      return { ...p, cookie: await sessionCookie(ctx, p.id) };
    };
    admin = await person({ role: 'ADMIN', name: 'Admin' });
    lead = await person({ role: 'LEAD', leadId: admin.id, name: 'Tobias Lechner' });
    emp = await person({ leadId: lead.id, name: 'Elif Aydin' });
    peer = await person({ leadId: lead.id, name: 'Sebastian Wolf' });
    otherLead = await person({ role: 'LEAD', leadId: admin.id, name: 'Andere Leitung' });
    otherEmp = await person({ leadId: otherLead.id, name: 'Lena Hofbauer' });
  });

  const post = (path: string, cookie: string) =>
    http(ctx).post(path).set('Origin', ORIGIN).set('Cookie', cookie);
  const get = (path: string, cookie: string) => http(ctx).get(path).set('Cookie', cookie);
  const leave = (from: string, to: string, extra: Record<string, unknown> = {}) => ({
    type: 'VACATION',
    from,
    to,
    startHalf: false,
    endHalf: false,
    ...extra,
  });
  const create = async (cookie: string, body: object, status = 201) =>
    (await post('/api/leave/requests', cookie).send(body).expect(status)).body as LeaveRequestView;
  const mailsTo = async (email: string) => {
    await ctx.mail.flush();
    return ctx.mail.sent.filter((m) => m.to === email);
  };

  describe('Antrag und Vorschau', () => {
    it('zählt nur Arbeitstage ohne Feiertage und nennt nicht gezählte Feiertage', async () => {
      const preview = (
        await post('/api/leave/preview', emp.cookie)
          .send(leave('2026-12-24', '2026-12-31'))
          .expect(200)
      ).body as LeavePreview;
      // Do 24., Mo 28. bis Do 31.12.; Fr 25.12. ist Feiertag, Sa 26.12. kein Arbeitstag.
      expect(preview).toMatchObject({
        halfDays: 10,
        errors: [],
        warnings: [],
        immediate: false,
        deciderName: 'Tobias Lechner',
        years: [{ year: 2026, halfDays: 10, restBefore: 60, restAfter: 50 }],
      });
      expect(preview.skippedHolidays).toEqual([{ date: '2026-12-25', name: '1. Weihnachtstag' }]);
    });

    it('legt einen offenen Antrag an und benachrichtigt die Vorgesetzte ohne Notiz', async () => {
      const created = await create(
        emp.cookie,
        leave('2026-11-02', '2026-11-06', { note: 'Familienbesuch', endHalf: true }),
      );
      expect(created).toMatchObject({
        status: 'PENDING',
        halfDays: 9,
        currentHalfDays: 9,
        note: 'Familienbesuch',
        enteredByName: null,
        canDecide: false,
        decision: null,
      });
      const mails = await mailsTo(lead.email);
      expect(mails).toHaveLength(1);
      expect(mails[0]?.text).toContain('Elif Aydin, Urlaub, 02.11.2026 – 06.11.2026, 4,5 Tage');
      expect(mails[0]?.text).not.toContain('Familienbesuch');
    });

    it('lehnt Vergangenheit, Zeitraum ohne Arbeitstag und Überschneidung ab', async () => {
      const past = await post('/api/leave/requests', emp.cookie)
        .send(leave('2026-10-09', '2026-10-13'))
        .expect(422);
      expect(past.body.message).toContain('Urlaub kann nur für kommende Tage beantragt werden.');
      const weekend = await post('/api/leave/requests', emp.cookie)
        .send(leave('2026-10-17', '2026-10-18'))
        .expect(422);
      expect(weekend.body.message).toContain('In diesem Zeitraum liegt keiner deiner Arbeitstage.');
      await create(emp.cookie, leave('2026-11-02', '2026-11-06'));
      const overlap = await post('/api/leave/requests', emp.cookie)
        .send(leave('2026-11-06', '2026-11-09'))
        .expect(422);
      expect(overlap.body.message).toContain('In diesem Zeitraum hast du schon einen Antrag.');
      await post('/api/leave/requests', emp.cookie)
        .send(leave('2026-11-02', '2026-11-02', { startHalf: true, endHalf: true }))
        .expect(422);
    });

    it('nimmt von parallelen Anträgen im selben Zeitraum genau einen an', async () => {
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          post('/api/leave/requests', emp.cookie).send(leave('2026-12-01', '2026-12-03')),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.every((r) => [201, 409, 422].includes(r.status))).toBe(true);
    });

    it('erlaubt einen Antrag über den Rest mit Warnung (Entscheidung 5)', async () => {
      const body = leave('2026-11-02', '2026-12-18');
      const preview = (await post('/api/leave/preview', emp.cookie).send(body).expect(200))
        .body as LeavePreview;
      expect(preview.warnings).toEqual(['Das übersteigt dein Urlaubskonto.']);
      expect(preview.years[0]?.restAfter).toBeLessThan(0);
      await create(emp.cookie, body);
    });

    it('zählt Anträge über den Jahreswechsel je Jahr', async () => {
      const preview = (
        await post('/api/leave/preview', emp.cookie)
          .send(leave('2026-12-28', '2027-01-05'))
          .expect(200)
      ).body as LeavePreview;
      expect(preview.years.map((y) => [y.year, y.halfDays])).toEqual([
        [2026, 8],
        [2027, 4],
      ]);
    });

    it('verlangt für Überstundenabbau ein aktives Überstundenkonto', async () => {
      const body = leave('2026-11-02', '2026-11-02', { type: 'OVERTIME_OFF' });
      const res = await post('/api/leave/requests', emp.cookie).send(body).expect(422);
      expect(res.body.message).toContain('nur mit aktivem Überstundenkonto');
      await ctx.prisma.employee.update({
        where: { id: emp.id },
        data: { overtimeAccountSince: fromLocalDate('2026-10-01') },
      });
      await create(emp.cookie, body);
    });
  });

  describe('Eintragen für andere (Entscheidung 6)', () => {
    it('lässt Vorgesetzte für ihr Team auch rückwirkend eintragen, sofort genehmigt', async () => {
      const entered = await create(lead.cookie, {
        ...leave('2026-10-05', '2026-10-06'),
        employeeId: emp.id,
      });
      expect(entered).toMatchObject({
        status: 'APPROVED',
        enteredByName: 'Tobias Lechner',
        decidedByName: 'Tobias Lechner',
      });
      expect(await mailsTo(emp.email)).toHaveLength(1);
    });

    it('verbietet Eintragen außerhalb des eigenen Teams und für Mitarbeiter', async () => {
      await post('/api/leave/requests', otherLead.cookie)
        .send({ ...leave('2026-11-02', '2026-11-02'), employeeId: emp.id })
        .expect(404);
      await post('/api/leave/requests', peer.cookie)
        .send({ ...leave('2026-11-02', '2026-11-02'), employeeId: emp.id })
        .expect(404);
    });

    it('sperrt rückwirkendes Eintragen in einen abgeschlossenen Monat', async () => {
      await ctx.prisma.monthClosing.create({
        data: { employeeId: emp.id, month: '2026-09', confirmedAt: new Date() },
      });
      const res = await post('/api/leave/requests', lead.cookie)
        .send({ ...leave('2026-09-28', '2026-10-02'), employeeId: emp.id })
        .expect(422);
      expect(res.body.message).toContain('Der Monat September 2026 ist abgeschlossen.');
    });

    it('genehmigt eigenen Urlaub des Admins sofort (Entscheidung 8)', async () => {
      const own = await create(admin.cookie, leave('2026-11-02', '2026-11-03'));
      expect(own.status).toBe('APPROVED');
    });
  });

  describe('Entscheidung', () => {
    it('genehmigt durch die Vorgesetzte, genau einmal, mit Mail an die Person', async () => {
      const r = await create(emp.cookie, leave('2026-11-02', '2026-11-06'));
      const view = (await get('/api/leave/requests?status=PENDING', lead.cookie).expect(200))
        .body as LeaveRequestView[];
      expect(view[0]).toMatchObject({ id: r.id, canDecide: true });
      expect(view[0]?.decision).toMatchObject({ restAfter: [{ year: 2026, rest: 50 }] });
      const results = await Promise.all([
        post(`/api/leave/requests/${r.id}/approve`, lead.cookie),
        post(`/api/leave/requests/${r.id}/approve`, admin.cookie),
      ]);
      expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
      expect(await mailsTo(emp.email)).toHaveLength(1);
      const account = (await get('/api/leave/account?year=2026', emp.cookie).expect(200))
        .body as LeaveAccountView;
      expect(account).toMatchObject({ entitlement: 60, approved: 10, pending: 0, rest: 50 });
    });

    it('zeigt Überschneidungen im Team mit Namen nur Entscheidenden', async () => {
      await create(peer.cookie, leave('2026-11-04', '2026-11-10'));
      const r = await create(emp.cookie, leave('2026-11-02', '2026-11-06'));
      const [forLead] = (
        (await get(`/api/leave/requests?employeeId=${emp.id}`, lead.cookie).expect(200))
          .body as LeaveRequestView[]
      ).filter((x) => x.id === r.id);
      expect(forLead?.decision?.overlaps).toEqual([
        { employeeName: 'Sebastian Wolf', from: '2026-11-04', to: '2026-11-10', status: 'PENDING' },
      ]);
      const own = (await get('/api/leave/requests', emp.cookie).expect(200))
        .body as LeaveRequestView[];
      expect(own.map((x) => x.employeeId)).toEqual([emp.id]);
      expect(JSON.stringify(own)).not.toContain('Sebastian');
    });

    it('verlangt eine Begründung für die Ablehnung und zeigt sie der Person', async () => {
      const r = await create(emp.cookie, leave('2026-11-02', '2026-11-06'));
      await post(`/api/leave/requests/${r.id}/reject`, lead.cookie)
        .send({ reason: 'zu kurz' })
        .expect(400);
      await post(`/api/leave/requests/${r.id}/reject`, lead.cookie)
        .send({ reason: 'In dieser Woche fehlt bereits ein Kollege im Support.' })
        .expect(200);
      const [mine] = (await get('/api/leave/requests', emp.cookie).expect(200))
        .body as LeaveRequestView[];
      expect(mine).toMatchObject({
        status: 'REJECTED',
        decisionReason: 'In dieser Woche fehlt bereits ein Kollege im Support.',
      });
      const mail = (await mailsTo(emp.email))[0];
      expect(mail?.text).not.toContain('Kollege');
    });

    it('lässt niemanden über eigene Anträge oder fremde Teams entscheiden', async () => {
      const own = await create(lead.cookie, leave('2026-11-02', '2026-11-06'));
      await post(`/api/leave/requests/${own.id}/approve`, lead.cookie).expect(403);
      const r = await create(emp.cookie, leave('2026-11-09', '2026-11-13'));
      await post(`/api/leave/requests/${r.id}/approve`, emp.cookie).expect(403);
      await post(`/api/leave/requests/${r.id}/approve`, peer.cookie).expect(404);
      await post(`/api/leave/requests/${r.id}/approve`, otherLead.cookie).expect(404);
      await post(`/api/leave/requests/${own.id}/approve`, admin.cookie).expect(200);
    });

    it('lässt nur die Person selbst offene Anträge zurückziehen', async () => {
      const r = await create(emp.cookie, leave('2026-11-02', '2026-11-06'));
      await post(`/api/leave/requests/${r.id}/withdraw`, lead.cookie).expect(404);
      await post(`/api/leave/requests/${r.id}/withdraw`, emp.cookie).expect(200);
      await post(`/api/leave/requests/${r.id}/withdraw`, emp.cookie).expect(409);
      await create(emp.cookie, leave('2026-11-02', '2026-11-06'));
    });
  });

  describe('Stornierung (Entscheidung 9)', () => {
    it('storniert auf Bitte der Person nach Bestätigung, die Tage gehen zurück', async () => {
      const r = await create(emp.cookie, leave('2026-11-02', '2026-11-06'));
      await post(`/api/leave/requests/${r.id}/approve`, lead.cookie).expect(200);
      await post(`/api/leave/requests/${r.id}/cancellation/approve`, lead.cookie).expect(409);
      await post(`/api/leave/requests/${r.id}/cancellation`, lead.cookie).expect(404);
      const asked = (await post(`/api/leave/requests/${r.id}/cancellation`, emp.cookie).expect(200))
        .body as LeaveRequestView;
      expect(asked.cancelRequestedAt).not.toBeNull();
      await post(`/api/leave/requests/${r.id}/cancellation/approve`, lead.cookie).expect(200);
      const account = (await get('/api/leave/account?year=2026', emp.cookie).expect(200))
        .body as LeaveAccountView;
      expect(account.approved).toBe(0);
    });

    it('lehnt die Stornierung nach Beginn ab', async () => {
      const r = await create(lead.cookie, {
        ...leave('2026-10-12', '2026-10-16'),
        employeeId: emp.id,
      });
      await post(`/api/leave/requests/${r.id}/cancellation`, emp.cookie).expect(409);
    });

    it('lässt die Stornierung zurückweisen; der Urlaub bleibt', async () => {
      const r = await create(emp.cookie, leave('2026-11-02', '2026-11-06'));
      await post(`/api/leave/requests/${r.id}/approve`, lead.cookie).expect(200);
      await post(`/api/leave/requests/${r.id}/cancellation`, emp.cookie).expect(200);
      const kept = (
        await post(`/api/leave/requests/${r.id}/cancellation/reject`, lead.cookie).expect(200)
      ).body as LeaveRequestView;
      expect(kept).toMatchObject({ status: 'APPROVED', cancelRequestedAt: null });
    });
  });

  describe('Vertretung (Entscheidung 7)', () => {
    beforeEach(async () => {
      await ctx.prisma.employee.update({ where: { id: emp.id }, data: { deputyId: peer.id } });
    });

    it('entscheidet nur, solange die Vorgesetzte abwesend ist, und bekommt dann die Mail', async () => {
      const before = await create(emp.cookie, leave('2026-11-02', '2026-11-06'));
      await post(`/api/leave/requests/${before.id}/approve`, peer.cookie).expect(404);
      // Vorgesetzter hat heute genehmigten Urlaub.
      await create(admin.cookie, { ...leave('2026-10-12', '2026-10-14'), employeeId: lead.id });
      const visible = (await get('/api/leave/requests', peer.cookie).expect(200))
        .body as LeaveRequestView[];
      expect(visible.map((v) => v.id)).toContain(before.id);
      await post(`/api/leave/requests/${before.id}/approve`, peer.cookie).expect(200);
      ctx.mail.sent.length = 0;
      await create(emp.cookie, leave('2026-11-09', '2026-11-10'));
      expect(await mailsTo(peer.email)).toHaveLength(1);
      expect(await mailsTo(lead.email)).toHaveLength(0);
      // Nach der Abwesenheit wieder keine Rechte.
      ctx.clock.set('2026-10-15T08:00:00.000Z');
      const later = await create(emp.cookie, leave('2026-11-16', '2026-11-17'));
      await post(`/api/leave/requests/${later.id}/approve`, peer.cookie).expect(404);
    });

    it('sieht als Vertretung das Konto, aber keine Zeiten', async () => {
      await create(admin.cookie, { ...leave('2026-10-12', '2026-10-14'), employeeId: lead.id });
      await get(`/api/leave/account?employeeId=${emp.id}&year=2026`, peer.cookie).expect(200);
      await get(`/api/time/week?employeeId=${emp.id}&week=2026-W42`, peer.cookie).expect(404);
    });
  });

  describe('Konto und Korrekturbuchungen', () => {
    it('rechnet Anspruch, Übertrag, Korrekturen, Genehmigt und Beantragt', async () => {
      await ctx.prisma.leaveCarryOver.create({
        data: { employeeId: emp.id, year: 2026, days: 3 },
      });
      await post(`/api/employees/${emp.id}/leave-ledger`, admin.cookie)
        .send({ year: 2026, halfDays: 3, note: 'Rückbuchung nach § 9 BUrlG' })
        .expect(201);
      await create(lead.cookie, { ...leave('2026-10-05', '2026-10-06'), employeeId: emp.id });
      await create(emp.cookie, leave('2026-11-02', '2026-11-02', { startHalf: true }));
      const account = (await get('/api/leave/account?year=2026', emp.cookie).expect(200))
        .body as LeaveAccountView;
      expect(account).toMatchObject({
        entitlement: 60,
        entitlementBasis: 'CONTRACT',
        carryOver: 6,
        corrections: 3,
        approved: 4,
        pending: 1,
        rest: 64,
      });
    });

    it('lässt Korrekturbuchungen nur den Admin anlegen und verlangt einen Vermerk', async () => {
      await post(`/api/employees/${emp.id}/leave-ledger`, lead.cookie)
        .send({ year: 2026, halfDays: 2, note: 'x' })
        .expect(403);
      await post(`/api/employees/${emp.id}/leave-ledger`, admin.cookie)
        .send({ year: 2026, halfDays: 2, note: ' ' })
        .expect(400);
      await post(`/api/employees/${emp.id}/leave-ledger`, admin.cookie)
        .send({ year: 2026, halfDays: 0, note: 'Test' })
        .expect(400);
    });

    it('zeigt Vorgesetzten die Konten ihres Teams, Mitarbeitern keine Liste', async () => {
      const accounts = (await get('/api/leave/accounts?year=2026', lead.cookie).expect(200))
        .body as LeaveAccountView[];
      expect(accounts.map((x) => x.employeeName).sort()).toEqual([
        'Elif Aydin',
        'Sebastian Wolf',
        'Tobias Lechner',
      ]);
      await get('/api/leave/accounts?year=2026', emp.cookie).expect(403);
      await get(`/api/leave/account?employeeId=${peer.id}&year=2026`, emp.cookie).expect(404);
    });
  });

  describe('Kalender (Konzept 4.4, Datenschutz)', () => {
    beforeEach(async () => {
      await create(lead.cookie, { ...leave('2026-11-02', '2026-11-04'), employeeId: peer.id });
      await create(peer.cookie, leave('2026-11-05', '2026-11-06'));
      await create(emp.cookie, leave('2026-11-03', '2026-11-03', { type: 'SPECIAL_LEAVE' }));
      await create(otherLead.cookie, {
        ...leave('2026-11-02', '2026-11-06'),
        employeeId: otherEmp.id,
      });
    });

    it('zeigt Mitarbeitern nur die eigene Zeile und die Anzahl genehmigter Abwesenheiten im Team', async () => {
      const res = await get('/api/leave/calendar?month=2026-11', emp.cookie).expect(200);
      const cal = res.body as LeaveCalendarView;
      expect(cal.rows.map((r) => r.employeeId)).toEqual([emp.id]);
      expect(cal.rows[0]?.cells[2]).toEqual({ status: 'PENDING', half: false });
      // 02.–04.11. Sebastian genehmigt; 05./06.11. nur beantragt, zählt nicht.
      expect(cal.teamAbsentCounts?.slice(0, 7)).toEqual([0, 1, 1, 1, 0, 0, 0]);
      const json = JSON.stringify(res.body);
      expect(json).not.toContain(peer.id);
      expect(json).not.toContain('Sebastian');
      expect(json).not.toContain(otherEmp.id);
      expect(json).not.toMatch(/VACATION|SPECIAL_LEAVE|OVERTIME_OFF/);
    });

    it('zeigt Vorgesetzten ihr Team mit offenen Anträgen, ohne Art und ohne andere Teams', async () => {
      const res = await get('/api/leave/calendar?month=2026-11', lead.cookie).expect(200);
      const cal = res.body as LeaveCalendarView;
      expect(cal.rows.map((r) => r.name).sort()).toEqual([
        'Elif Aydin',
        'Sebastian Wolf',
        'Tobias Lechner',
      ]);
      const sebastian = cal.rows.find((r) => r.name === 'Sebastian Wolf');
      expect(sebastian?.cells[4]).toEqual({ status: 'PENDING', half: false });
      expect(cal.teamAbsentCounts).toBeNull();
      expect(JSON.stringify(res.body)).not.toMatch(/VACATION|SPECIAL_LEAVE|Lena/);
      const all = (await get('/api/leave/calendar?month=2026-11', admin.cookie).expect(200))
        .body as LeaveCalendarView;
      expect(all.rows).toHaveLength(6);
    });
  });

  describe('Zeiterfassung (Abschnitt 6.6)', () => {
    it('setzt das Soll an Urlaubstagen auf 0, am halben Tag auf die Hälfte, ohne „Keine Buchung“', async () => {
      await create(lead.cookie, {
        ...leave('2026-10-05', '2026-10-07', { endHalf: true }),
        employeeId: emp.id,
      });
      const week = (await get('/api/time/week?week=2026-W41', emp.cookie).expect(200))
        .body as WeekView;
      const [mon, , wed, thu] = week.days;
      expect(mon).toMatchObject({
        absence: { type: 'VACATION', half: false },
        targetMinutes: 0,
        missing: false,
      });
      expect(wed).toMatchObject({
        absence: { type: 'VACATION', half: true },
        targetMinutes: 240,
        missing: true,
      });
      expect(thu).toMatchObject({ absence: null, targetMinutes: 480, missing: true });
    });

    it('lässt das Soll bei Überstundenabbau stehen und senkt den Saldo', async () => {
      await ctx.prisma.employee.update({
        where: { id: emp.id },
        data: { overtimeAccountSince: fromLocalDate('2026-10-05') },
      });
      await create(lead.cookie, {
        ...leave('2026-10-05', '2026-10-05', { type: 'OVERTIME_OFF' }),
        employeeId: emp.id,
      });
      await create(lead.cookie, {
        ...leave('2026-10-06', '2026-10-09'),
        employeeId: emp.id,
      });
      const week = (await get('/api/time/week?week=2026-W41', emp.cookie).expect(200))
        .body as WeekView;
      expect(week.days[0]).toMatchObject({
        absence: { type: 'OVERTIME_OFF', half: false },
        targetMinutes: 480,
        balanceMinutes: -480,
        missing: false,
      });
      const overtime = (await get('/api/time/overtime', emp.cookie).expect(200))
        .body as OvertimeView;
      expect(overtime.balanceMinutes).toBe(-480);
    });

    it('meldet Buchungen an Urlaubstagen nur als Hinweis', async () => {
      await create(lead.cookie, { ...leave('2026-10-09', '2026-10-09'), employeeId: emp.id });
      await post('/api/time/entries', emp.cookie)
        .send({
          date: '2026-10-09',
          start: '08:00',
          end: '10:00',
          breaks: [],
          reason: 'Kurz eingesprungen',
        })
        .expect(201);
      const week = (await get('/api/time/week?week=2026-W41', emp.cookie).expect(200))
        .body as WeekView;
      expect(week.days[4]?.flags).toContainEqual({
        code: 'ABSENCE_WORK',
        text: 'Buchung an einem Urlaubstag',
        level: 'info',
      });
    });

    it('zeigt in „Team heute“ abwesend ohne Grund', async () => {
      await create(lead.cookie, { ...leave('2026-10-12', '2026-10-12'), employeeId: emp.id });
      const team = (await get('/api/time/team-today', lead.cookie).expect(200))
        .body as TeamTodayRow[];
      expect(team.find((r) => r.employeeId === emp.id)?.presence).toBe('ABSENT');
      expect(JSON.stringify(team)).not.toContain('VACATION');
    });

    it('lässt die Vertretung Korrekturanträge entscheiden, solange die Vorgesetzte abwesend ist', async () => {
      await ctx.prisma.employee.update({ where: { id: emp.id }, data: { deputyId: peer.id } });
      const entry = await post('/api/time/entries', emp.cookie)
        .send({
          date: '2026-10-09',
          start: '08:00',
          end: '16:00',
          breaks: [{ start: '12:00', end: '12:30' }],
          reason: 'Vergessen',
        })
        .expect(201);
      const corr = await post(`/api/time/entries/${entry.body.entry.id}/correct`, emp.cookie)
        .send({
          start: '07:30',
          end: '16:00',
          breaks: [{ start: '12:00', end: '12:30' }],
          reason: 'Früher',
        })
        .expect(200);
      const id = corr.body.request.id as string;
      await post(`/api/time/corrections/${id}/approve`, peer.cookie).expect(404);
      await create(admin.cookie, { ...leave('2026-10-12', '2026-10-13'), employeeId: lead.id });
      const list = (await get('/api/time/corrections?status=PENDING', peer.cookie).expect(200))
        .body as CorrectionRequestView[];
      expect(list.map((r) => r.id)).toEqual([id]);
      await post(`/api/time/corrections/${id}/approve`, peer.cookie).expect(200);
    });
  });

  describe('Meldung offener Anträge (Entscheidung 12)', () => {
    it('meldet nach mehr als fünf Arbeitstagen ab 07:00 genau einmal an den Admin', async () => {
      const overdue = ctx.app.get(LeaveOverdueService);
      await create(emp.cookie, leave('2026-11-02', '2026-11-06'));
      ctx.mail.sent.length = 0;
      ctx.clock.set('2026-10-19T08:00:00.000Z'); // fünf Arbeitstage
      expect(await overdue.runOnce()).toBe(0);
      ctx.clock.set('2026-10-20T04:30:00.000Z'); // 06:30 Uhr, sechs Arbeitstage
      expect(await overdue.runOnce()).toBe(0);
      ctx.clock.set('2026-10-20T05:00:00.000Z'); // 07:00 Uhr
      const results = await Promise.all([overdue.runOnce(), overdue.runOnce()]);
      expect(results.reduce((a, b) => a + b, 0)).toBe(1);
      expect(await overdue.runOnce()).toBe(0);
      const mails = await mailsTo(admin.email);
      expect(mails).toHaveLength(1);
      expect(mails[0]?.text).toContain('Elif Aydin, Urlaub, 02.11.2026 – 06.11.2026, 5 Tage');
      const [view] = (await get('/api/leave/requests?status=PENDING', lead.cookie).expect(200))
        .body as LeaveRequestView[];
      expect(view?.decision?.openBusinessDays).toBe(6);
    });
  });

  it('zeigt im Profil, wie viele Personen man gerade vertritt', async () => {
    await ctx.prisma.employee.update({ where: { id: emp.id }, data: { deputyId: peer.id } });
    expect((await get('/api/me', peer.cookie).expect(200)).body.representing).toBe(0);
    await create(admin.cookie, { ...leave('2026-10-12', '2026-10-12'), employeeId: lead.id });
    expect((await get('/api/me', peer.cookie).expect(200)).body.representing).toBe(1);
  });

  describe('Befunde Codex-Review Phase 3 API', () => {
    it('zeigt einer Vertretung Überschneidungen nicht vertretener Kollegen nur als Anzahl (1)', async () => {
      const third = await createEmployee(ctx.prisma, { leadId: lead.id, name: 'Marco Pichler' });
      await ctx.prisma.employee.update({ where: { id: emp.id }, data: { deputyId: peer.id } });
      await create(lead.cookie, { ...leave('2026-11-03', '2026-11-04'), employeeId: third.id });
      const r = await create(emp.cookie, leave('2026-11-02', '2026-11-06'));
      await create(admin.cookie, { ...leave('2026-10-12', '2026-10-13'), employeeId: lead.id });
      const [seen] = (
        (await get('/api/leave/requests?status=PENDING', peer.cookie).expect(200))
          .body as LeaveRequestView[]
      ).filter((x) => x.id === r.id);
      // Die Abwesenheit der Vorgesetzten selbst sieht die Vertretung ebenfalls nur als Anzahl.
      expect(seen?.decision?.overlaps).toEqual([]);
      expect(seen?.decision?.otherOverlaps).toBe(1);
      expect(JSON.stringify(seen)).not.toContain('Marco');
      const [forAdmin] = (
        (await get('/api/leave/requests?status=PENDING', admin.cookie).expect(200))
          .body as LeaveRequestView[]
      ).filter((x) => x.id === r.id);
      expect(forAdmin?.decision?.overlaps.map((o) => o.employeeName)).toEqual(['Marco Pichler']);
    });

    it('benachrichtigt keine gesperrten oder ausgetretenen Vorgesetzten (2)', async () => {
      await ctx.prisma.employee.update({ where: { id: lead.id }, data: { lockedAt: new Date() } });
      ctx.mail.sent.length = 0;
      await create(emp.cookie, leave('2026-11-02', '2026-11-06'));
      expect(await mailsTo(lead.email)).toHaveLength(0);
      expect(await mailsTo(admin.email)).toHaveLength(1);
      await ctx.prisma.employee.update({
        where: { id: lead.id },
        data: { lockedAt: null, exitDate: fromLocalDate('2026-10-01') },
      });
      ctx.mail.sent.length = 0;
      await create(emp.cookie, leave('2026-11-09', '2026-11-09'));
      expect(await mailsTo(lead.email)).toHaveLength(0);
    });

    it('genehmigt nichts in einen inzwischen abgeschlossenen Monat (3)', async () => {
      const r = await create(emp.cookie, leave('2026-10-26', '2026-10-27'));
      ctx.clock.set('2026-11-03T08:00:00.000Z');
      await post('/api/time/months/2026-10/close', emp.cookie).expect(200);
      const res = await post(`/api/leave/requests/${r.id}/approve`, lead.cookie).expect(409);
      expect(res.body.message).toContain('Der Monat Oktober 2026 ist abgeschlossen.');
    });

    it('prüft Überstundenabbau über alle Vertragsstände und erneut bei der Genehmigung (4)', async () => {
      await ctx.prisma.employee.update({
        where: { id: emp.id },
        data: { overtimeAccountSince: fromLocalDate('2026-10-01') },
      });
      await ctx.prisma.employmentTerms.create({
        data: {
          employeeId: emp.id,
          validFrom: fromLocalDate('2026-11-01'),
          type: 'MINIJOB',
          weeklyMinutes: 480,
          workDays: [1, 2, 3, 4, 5],
          annualLeaveDays: 20,
          hourlyWageCents: 1400,
        },
      });
      const res = await post('/api/leave/requests', emp.cookie)
        .send(leave('2026-10-30', '2026-11-03', { type: 'OVERTIME_OFF' }))
        .expect(422);
      expect(res.body.message).toContain('Minijobber haben kein Überstundenkonto.');
      const ok = await create(
        emp.cookie,
        leave('2026-10-29', '2026-10-30', { type: 'OVERTIME_OFF' }),
      );
      await ctx.prisma.employee.update({
        where: { id: emp.id },
        data: { overtimeAccountSince: null },
      });
      await post(`/api/leave/requests/${ok.id}/approve`, lead.cookie).expect(409);
    });

    it('gibt die Meldung offener Anträge bei Versandfehler für den nächsten Lauf frei (5)', async () => {
      const overdue = ctx.app.get(LeaveOverdueService);
      await create(emp.cookie, leave('2026-11-02', '2026-11-06'));
      ctx.clock.set('2026-10-20T08:00:00.000Z');
      const spy = jest.spyOn(ctx.mail, 'send').mockRejectedValueOnce(new Error('SMTP'));
      expect(await overdue.runOnce()).toBe(0);
      spy.mockRestore();
      expect(await overdue.runOnce()).toBe(1);
    });

    it('speichert die Stornierungsbitte nur zusammen mit dem Protokolleintrag (7)', async () => {
      const r = await create(lead.cookie, {
        ...leave('2026-11-02', '2026-11-06'),
        employeeId: emp.id,
      });
      const spy = jest
        .spyOn(ctx.app.get(AuditService), 'record')
        .mockRejectedValueOnce(new Error('Audit'));
      await post(`/api/leave/requests/${r.id}/cancellation`, emp.cookie).expect(500);
      spy.mockRestore();
      const row = await ctx.prisma.leaveRequest.findUniqueOrThrow({ where: { id: r.id } });
      expect(row.cancelRequestedAt).toBeNull();
      await post(`/api/leave/requests/${r.id}/cancellation`, emp.cookie).expect(200);
    });
  });
});
