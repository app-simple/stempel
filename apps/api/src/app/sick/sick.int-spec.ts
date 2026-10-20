import type { SickLeaveView } from '@as/shared';
import { fromLocalDate } from '../common/dates';
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
 * Krankmeldungen (Spezifikation Phase 6, Abschnitte 3, 4, 6, 7). Heute ist Mittwoch, 14.10.2026,
 * 10:00 Uhr in Berlin. Elif gehört zum Team von Tobias, Lena zum Team des Admins.
 */
describe('Krankmeldungen', () => {
  let ctx: TestContext;
  type Person = { id: string; email: string; cookie: string };
  let admin: Person;
  let lead: Person;
  let emp: Person;
  let other: Person;

  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.clock.set('2026-10-14T08:00:00.000Z');
    ctx.mail.sent.length = 0;
    await seedLegalParameters(ctx.prisma);
    const person = async (seed: Parameters<typeof createEmployee>[1]): Promise<Person> => {
      const p = await createEmployee(ctx.prisma, seed);
      return { ...p, cookie: await sessionCookie(ctx, p.id) };
    };
    admin = await person({ role: 'ADMIN', name: 'Admin' });
    lead = await person({ role: 'LEAD', leadId: admin.id, name: 'Tobias Lechner' });
    emp = await person({ leadId: lead.id, name: 'Elif Aydin' });
    other = await person({ leadId: admin.id, name: 'Lena Hofbauer' });
  });

  const send = (method: 'post' | 'patch' | 'put' | 'delete', path: string, cookie: string) =>
    http(ctx)[method](path).set('Origin', ORIGIN).set('Cookie', cookie);
  const get = (path: string, cookie: string) => http(ctx).get(path).set('Cookie', cookie);
  const report = (cookie: string, body: Record<string, unknown>) =>
    send('post', '/api/sick', cookie).send(body);
  const mailsTo = (email: string) => ctx.mail.sent.filter((m) => m.to === email);
  const credit = async (employeeId: string) => {
    const rows = await ctx.prisma.leaveLedgerEntry.findMany({
      where: { employeeId, kind: 'SICK_CREDIT' },
    });
    const byYear = new Map<number, number>();
    for (const r of rows) byYear.set(r.year, (byYear.get(r.year) ?? 0) + r.halfDays);
    return Object.fromEntries(byYear);
  };
  const vacation = (employeeId: string, from: string, to: string) =>
    ctx.prisma.leaveRequest.create({
      data: {
        employeeId,
        type: 'VACATION',
        from: fromLocalDate(from),
        to: fromLocalDate(to),
        halfDays: 10,
        status: 'APPROVED',
        requestedAt: new Date(),
        requestedById: employeeId,
        decidedAt: new Date(),
        decidedById: lead.id,
      },
    });

  describe('Erfassen', () => {
    it('meldet sich selbst krank, protokolliert und benachrichtigt die Vorgesetzte neutral', async () => {
      const res = await report(emp.cookie, { kind: 'SICK', from: '2026-10-14', to: '2026-10-16' });
      expect(res.status).toBe(201);
      const view = res.body as SickLeaveView;
      expect(view).toMatchObject({
        employeeId: emp.id,
        employeeName: 'Elif Aydin',
        kind: 'SICK',
        from: '2026-10-14',
        to: '2026-10-16',
        sinceLocal: null,
        certificateUntil: null,
        certificateDue: null,
        certificateMissing: false,
      });
      const audit = await ctx.prisma.auditLog.findMany({ where: { entityId: view.id } });
      expect(audit.map((a) => a.action)).toEqual(['sick.create']);
      const mails = mailsTo(lead.email);
      expect(mails).toHaveLength(1);
      expect(mails[0]?.text).toContain(
        'Elif Aydin ist ab 14.10.2026 krankgemeldet, voraussichtlich bis 16.10.2026.',
      );
      expect(ctx.mail.sent).toHaveLength(1);
    });

    it('nennt „Kind krank“ in der E-Mail nicht', async () => {
      await report(emp.cookie, { kind: 'CHILD_SICK', from: '2026-10-14', to: '2026-10-14' }).expect(
        201,
      );
      const text = `${mailsTo(lead.email)[0]?.subject} ${mailsTo(lead.email)[0]?.text}`;
      expect(text).not.toMatch(/Kind/i);
      expect(text).toContain('krankgemeldet');
    });

    it('lässt Selbstmeldungen höchstens 7 Tage rückwirkend zu', async () => {
      await report(emp.cookie, { kind: 'SICK', from: '2026-10-07', to: '2026-10-07' }).expect(201);
      const res = await report(emp.cookie, { kind: 'SICK', from: '2026-10-06', to: '2026-10-06' });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('höchstens 7 Tage');
      // Vorgesetzte dürfen weiter zurück.
      await report(lead.cookie, {
        employeeId: emp.id,
        kind: 'SICK',
        from: '2026-09-01',
        to: '2026-09-02',
      }).expect(201);
    });

    it('lässt Vorgesetzte nur für ihr Team und Mitarbeiter nur für sich eintragen (Review Focus 3)', async () => {
      const body = { kind: 'SICK', from: '2026-10-14', to: '2026-10-14' };
      await report(lead.cookie, { ...body, employeeId: emp.id }).expect(201);
      expect(ctx.mail.sent).toHaveLength(0);
      await report(lead.cookie, { ...body, employeeId: other.id }).expect(404);
      await report(emp.cookie, { ...body, employeeId: other.id }).expect(404);
      await report(admin.cookie, { ...body, employeeId: other.id }).expect(201);
      expect(await ctx.prisma.sickLeave.count({ where: { employeeId: other.id } })).toBe(1);
    });

    it('lehnt Überschneidungen ab, auch bei gleichzeitigen Meldungen (Review Focus 5)', async () => {
      const body = { kind: 'SICK', from: '2026-10-14', to: '2026-10-15' };
      const results = await Promise.all([report(emp.cookie, body), report(emp.cookie, body)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)?.body.message).toBe(
        'Für diesen Zeitraum gibt es schon eine Krankmeldung.',
      );
      expect(await ctx.prisma.sickLeave.count()).toBe(1);
      expect(mailsTo(lead.email)).toHaveLength(1);
    });

    it('merkt sich beim Heimgehen die Serverzeit und beendet keine Buchung (Review Focus 4)', async () => {
      await ctx.prisma.timeEntry.create({
        data: {
          employeeId: emp.id,
          workDate: fromLocalDate('2026-10-14'),
          startAt: new Date('2026-10-14T06:00:00Z'),
          source: 'CLOCK',
          recordedAt: new Date('2026-10-14T06:00:00Z'),
          recordedById: emp.id,
        },
      });
      const res = await report(emp.cookie, {
        kind: 'SICK',
        from: '2026-10-14',
        to: '2026-10-14',
        sinceNow: true,
      }).expect(201);
      expect(res.body.sinceLocal).toBe('10:00');
      const open = await ctx.prisma.timeEntry.findFirst({ where: { employeeId: emp.id } });
      expect(open?.endAt).toBeNull();
    });
  });

  describe('Ändern', () => {
    it('lässt die Person verlängern (mit E-Mail) und „wieder gesund“ melden, aber nicht rückwirkend kürzen', async () => {
      const created = (
        await report(emp.cookie, { kind: 'SICK', from: '2026-10-12', to: '2026-10-14' })
      ).body as SickLeaveView;
      ctx.mail.sent.length = 0;
      const extended = await send('patch', `/api/sick/${created.id}`, emp.cookie)
        .send({ to: '2026-10-16' })
        .expect(200);
      expect(extended.body.to).toBe('2026-10-16');
      expect(mailsTo(lead.email)[0]?.text).toContain('voraussichtlich bis 16.10.2026');
      await send('patch', `/api/sick/${created.id}`, emp.cookie)
        .send({ to: '2026-10-12' })
        .expect(400);
      const ended = await send('patch', `/api/sick/${created.id}`, emp.cookie)
        .send({ endToday: true })
        .expect(200);
      expect(ended.body.to).toBe('2026-10-13');
      await send('patch', `/api/sick/${created.id}`, other.cookie)
        .send({ to: '2026-10-20' })
        .expect(404);
      // Vorgesetzte dürfen auch rückwirkend kürzen.
      await send('patch', `/api/sick/${created.id}`, lead.cookie)
        .send({ to: '2026-10-12' })
        .expect(200);
    });
  });

  describe('Grenzen der Selbstmeldung (Sicherheitsreview)', () => {
    it('verlängert eine abgelaufene eigene Krankmeldung nicht (kein Rückdatieren über die 7 Tage hinaus)', async () => {
      const old = (
        await report(lead.cookie, {
          employeeId: emp.id,
          kind: 'SICK',
          from: '2026-10-05',
          to: '2026-10-06',
        })
      ).body as SickLeaveView;
      const res = await send('patch', `/api/sick/${old.id}`, emp.cookie).send({ to: '2026-10-14' });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Vorgesetzte');
      await send('patch', `/api/sick/${old.id}`, lead.cookie)
        .send({ to: '2026-10-14' })
        .expect(200);
    });

    it('lässt Selbstmeldungen nicht in der Zukunft beginnen und höchstens 14 Tage vorausreichen', async () => {
      const future = await report(emp.cookie, {
        kind: 'SICK',
        from: '2026-10-20',
        to: '2026-10-20',
      });
      expect(future.status).toBe(400);
      const far = await report(emp.cookie, { kind: 'SICK', from: '2026-10-14', to: '2026-10-29' });
      expect(far.status).toBe(400);
      const ok = (await report(emp.cookie, { kind: 'SICK', from: '2026-10-14', to: '2026-10-28' }))
        .body as SickLeaveView;
      await send('patch', `/api/sick/${ok.id}`, emp.cookie).send({ to: '2026-10-29' }).expect(400);
      // Vorgesetzte dürfen planen (z. B. Operation) und weiter verlängern.
      await send('patch', `/api/sick/${ok.id}`, lead.cookie).send({ to: '2026-11-20' }).expect(200);
      await report(lead.cookie, {
        employeeId: emp.id,
        kind: 'SICK',
        from: '2026-12-01',
        to: '2026-12-10',
      }).expect(201);
    });
  });

  describe('AU und Urlaub', () => {
    it('setzt den AU-Vermerk nur durch Vorgesetzte (Team) und Admin und meldet fehlende AU', async () => {
      const created = (
        await report(lead.cookie, {
          employeeId: emp.id,
          kind: 'SICK',
          from: '2026-10-08',
          to: '2026-10-14',
        })
      ).body as SickLeaveView;
      // 4. Kalendertag ist Sonntag, 11.10.: fällig am Montag, 12.10.
      expect(created.certificateDue).toBe('2026-10-12');
      expect(created.certificateMissing).toBe(true);
      await send('put', `/api/sick/${created.id}/certificate`, emp.cookie)
        .send({ until: '2026-10-14' })
        .expect(403);
      const otherLead = await createEmployee(ctx.prisma, { role: 'LEAD', leadId: admin.id });
      await send(
        'put',
        `/api/sick/${created.id}/certificate`,
        await sessionCookie(ctx, otherLead.id),
      )
        .send({ until: '2026-10-14' })
        .expect(404);
      const res = await send('put', `/api/sick/${created.id}/certificate`, lead.cookie)
        .send({ until: '2026-10-14' })
        .expect(200);
      expect(res.body).toMatchObject({ certificateUntil: '2026-10-14', certificateMissing: false });
    });

    it('verlangt die AU ab dem 1. Tag, wenn der Admin das eingestellt hat', async () => {
      await send('patch', `/api/employees/${emp.id}/certificate-from-day1`, lead.cookie)
        .send({ value: true })
        .expect(403);
      await send('patch', `/api/employees/${emp.id}/certificate-from-day1`, admin.cookie)
        .send({ value: true })
        .expect(200);
      const res = await report(emp.cookie, { kind: 'SICK', from: '2026-10-14', to: '2026-10-14' });
      expect(res.body.certificateDue).toBe('2026-10-14');
      expect(res.body.certificateMissing).toBe(true);
    });

    it('bucht Urlaubstage mit AU automatisch zurück und gleicht bei Änderungen ab (§ 9 BUrlG)', async () => {
      await vacation(emp.id, '2026-10-19', '2026-10-23');
      const created = (
        await report(lead.cookie, {
          employeeId: emp.id,
          kind: 'SICK',
          from: '2026-10-20',
          to: '2026-10-22',
        })
      ).body as SickLeaveView;
      expect(await credit(emp.id)).toEqual({});
      await send('put', `/api/sick/${created.id}/certificate`, lead.cookie)
        .send({ until: '2026-10-22' })
        .expect(200);
      expect(await credit(emp.id)).toEqual({ 2026: 6 });
      await send('patch', `/api/sick/${created.id}`, lead.cookie)
        .send({ to: '2026-10-21' })
        .expect(200);
      expect(await credit(emp.id)).toEqual({ 2026: 4 });
      await send('delete', `/api/sick/${created.id}`, lead.cookie)
        .send({ reason: 'Fehleintrag' })
        .expect(403);
      await send('delete', `/api/sick/${created.id}`, admin.cookie)
        .send({ reason: 'Fehleintrag' })
        .expect(204);
      expect(await credit(emp.id)).toEqual({ 2026: 0 });
      expect(await ctx.prisma.sickLeave.count()).toBe(0);
    });

    it('bucht über den Jahreswechsel je Jahr zurück (Review Focus 1)', async () => {
      await vacation(emp.id, '2026-12-28', '2027-01-05');
      const created = (
        await report(admin.cookie, {
          employeeId: emp.id,
          kind: 'SICK',
          from: '2026-12-30',
          to: '2027-01-04',
        })
      ).body as SickLeaveView;
      await send('put', `/api/sick/${created.id}/certificate`, admin.cookie)
        .send({ until: '2027-01-04' })
        .expect(200);
      // Mi 30.12., Do 31.12. | Mo 04.01.; Neujahr ist Feiertag und kein Urlaubstag.
      expect(await credit(emp.id)).toEqual({ 2026: 4, 2027: 2 });
    });
  });

  describe('Lesen', () => {
    it('zeigt Krankmeldungen nur der Person, ihrer Vorgesetzten und dem Admin', async () => {
      await report(emp.cookie, { kind: 'SICK', from: '2026-10-14', to: '2026-10-14' }).expect(201);
      await report(other.cookie, {
        kind: 'CHILD_SICK',
        from: '2026-10-14',
        to: '2026-10-14',
      }).expect(201);
      const names = async (cookie: string) =>
        ((await get('/api/sick', cookie).expect(200)).body as SickLeaveView[])
          .map((s) => s.employeeName)
          .sort();
      expect(await names(emp.cookie)).toEqual(['Elif Aydin']);
      expect(await names(other.cookie)).toEqual(['Lena Hofbauer']);
      expect(await names(lead.cookie)).toEqual(['Elif Aydin']);
      expect(await names(admin.cookie)).toEqual(['Elif Aydin', 'Lena Hofbauer']);
      await get(`/api/sick?employeeId=${other.id}`, lead.cookie).expect(404);
    });
  });
});
