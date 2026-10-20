import type { ChecksView, RuleFlag, TodayView, WeekView } from '@as/shared';
import { fromLocalDate } from '../common/dates';
import { RemindersService } from '../reminders/reminders.service';
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
 * Jugendarbeitsschutz (Spezifikation Phase 7). Heute ist Montag, 12.10.2026; Berlin = UTC+2.
 * Paula ist am 01.03.2010 geboren (16 Jahre) und gehört zum Team von Tobias.
 */
describe('Jugendarbeitsschutz', () => {
  let ctx: TestContext;
  type Person = { id: string; email: string; cookie: string };
  let admin: Person;
  let lead: Person;
  let youth: Person;
  let adult: Person;

  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.clock.set('2026-10-12T05:00:00.000Z');
    ctx.mail.sent.length = 0;
    await seedLegalParameters(ctx.prisma);
    const person = async (seed: Parameters<typeof createEmployee>[1]): Promise<Person> => {
      const p = await createEmployee(ctx.prisma, seed);
      return { ...p, cookie: await sessionCookie(ctx, p.id) };
    };
    admin = await person({ role: 'ADMIN', name: 'Admin' });
    lead = await person({ role: 'LEAD', leadId: admin.id, name: 'Tobias Lechner' });
    youth = await person({ leadId: lead.id, name: 'Paula Jung' });
    adult = await person({ leadId: lead.id, name: 'Elif Aydin' });
    await ctx.prisma.employee.update({
      where: { id: youth.id },
      data: { birthDate: fromLocalDate('2010-03-01') },
    });
  });

  const send = (method: 'post' | 'patch' | 'delete', path: string, cookie: string) =>
    http(ctx)[method](path).set('Origin', ORIGIN).set('Cookie', cookie);
  const get = (path: string, cookie: string) => http(ctx).get(path).set('Cookie', cookie);
  /** Buchung mit Berliner Uhrzeiten am 12.10.2026 (UTC+2). */
  const entry = (employeeId: string, start: string, end: string | null, date = '2026-10-12') =>
    ctx.prisma.timeEntry.create({
      data: {
        employeeId,
        workDate: fromLocalDate(date),
        startAt: new Date(`${date}T${start}:00+02:00`),
        endAt: end ? new Date(`${date}T${end}:00+02:00`) : null,
        source: 'CLOCK',
        recordedAt: new Date(`${date}T${start}:00+02:00`),
        recordedById: employeeId,
      },
    });
  const flagsOn = async (employeeId: string, date: string): Promise<RuleFlag[]> =>
    (
      (await get(`/api/time/week?week=2026-W42&employeeId=${employeeId}`, admin.cookie).expect(200))
        .body as WeekView
    ).days.find((d) => d.date === date)!.flags;

  describe('Stammdaten', () => {
    it('zeigt Geburtsdatum und Schulpflicht nur dem Admin (Review Focus 5)', async () => {
      await send('patch', `/api/employees/${youth.id}`, admin.cookie)
        .send({ fullTimeSchoolUntil: '2027-07-31' })
        .expect(200);
      const forAdmin = await get(`/api/employees/${youth.id}`, admin.cookie).expect(200);
      expect(forAdmin.body).toMatchObject({
        birthDate: '2010-03-01',
        fullTimeSchoolUntil: '2027-07-31',
      });
      const forLead = await get(`/api/employees/${youth.id}`, lead.cookie).expect(200);
      expect(forLead.body).not.toHaveProperty('birthDate');
      expect(forLead.body).not.toHaveProperty('fullTimeSchoolUntil');
      const list = await get('/api/employees', lead.cookie).expect(200);
      expect(JSON.stringify(list.body)).not.toContain('2010-03-01');
      const own = await get('/api/me', youth.cookie).expect(200);
      expect(own.body).not.toHaveProperty('birthDate');
      expect(own.body).not.toHaveProperty('fullTimeSchoolUntil');
      await send('patch', `/api/employees/${youth.id}`, lead.cookie)
        .send({ birthDate: '2009-01-01' })
        .expect(403);
    });

    it('lehnt Personen unter 15 und Geburtsdaten in der Zukunft ab', async () => {
      const young = await send('patch', `/api/employees/${adult.id}`, admin.cookie).send({
        birthDate: '2011-06-01',
      });
      expect(young.status).toBe(400);
      expect(young.body.message).toContain('15');
      await send('patch', `/api/employees/${adult.id}`, admin.cookie)
        .send({ birthDate: '2027-01-01' })
        .expect(400);
    });

    it('lehnt einen Vertragsstand unter dem Jugendmindesturlaub ab (§ 19 JArbSchG)', async () => {
      // Am 01.01.2027 ist Paula 16: 27 Werktage → 23 Arbeitstage bei 5-Tage-Woche.
      const terms = (annualLeaveDays: number) => ({
        validFrom: '2027-01-01',
        type: 'PART_TIME',
        weeklyMinutes: 1200,
        workDays: [1, 2, 3, 4, 5],
        annualLeaveDays,
        extraLeaveDays: 0,
        hourlyWageCents: null,
      });
      const low = await send('post', `/api/employees/${youth.id}/terms`, admin.cookie).send(
        terms(22),
      );
      expect(low.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(low.body)).toContain('§ 19');
      await send('post', `/api/employees/${youth.id}/terms`, admin.cookie)
        .send(terms(23))
        .expect(201);
    });

    it('nutzt nach nachgetragenem Geburtsdatum den Jugendmindesturlaub im Konto (Review Focus 4)', async () => {
      await ctx.prisma.employmentTerms.updateMany({
        where: { employeeId: adult.id },
        data: { annualLeaveDays: 20 },
      });
      await send('patch', `/api/employees/${adult.id}`, admin.cookie)
        .send({ birthDate: '2010-09-01' })
        .expect(200);
      const view = await get(`/api/employees/${adult.id}`, admin.cookie).expect(200);
      expect(JSON.stringify(view.body.warnings)).toContain('§ 19');
      const account = await get(
        `/api/leave/account?employeeId=${adult.id}&year=2026`,
        admin.cookie,
      ).expect(200);
      // Am 01.01.2026 war die Person 15: 30 Werktage → 25 Arbeitstage = 50 halbe Tage.
      expect(account.body.entitlement).toBe(50);
    });
  });

  describe('Review API Phase 7', () => {
    it('prüft nach nachgetragenem Geburtsdatum alle Vertragsstände, auch künftige (Befund 4)', async () => {
      await ctx.prisma.employmentTerms.create({
        data: {
          employeeId: adult.id,
          validFrom: fromLocalDate('2027-01-01'),
          type: 'FULL_TIME',
          weeklyMinutes: 2400,
          workDays: [1, 2, 3, 4, 5],
          annualLeaveDays: 20,
          extraLeaveDays: 0,
          hourlyWageCents: null,
        },
      });
      await send('patch', `/api/employees/${adult.id}`, admin.cookie)
        .send({ birthDate: '2010-09-01' })
        .expect(200);
      const view = await get(`/api/employees/${adult.id}`, admin.cookie).expect(200);
      const youth = (view.body.warnings as { code: string; text: string }[]).filter(
        (w) => w.code === 'YOUTH_MIN_VACATION',
      );
      // 2026: 15 am 1.1. → 25 Tage, der aktuelle Stand (30) reicht; 2027: 16 → 23 Tage, 20 reichen nicht.
      expect(youth).toEqual([
        {
          code: 'YOUTH_MIN_VACATION',
          text: 'Vertragsstand ab 01.01.2027: Jahresurlaub unter dem Mindesturlaub für Jugendliche: mindestens 23 Tage (§ 19 Abs. 2 JArbSchG).',
        },
      ]);
    });

    it('bewertet einen Tag am Monatsende mit der ganzen Woche, auch im Monatszeitraum (Befund 3)', async () => {
      // Woche 28.09.–04.10.2026: Mittwoch 8,5 Std., Donnerstag 7,5 Std. → Ausgleich (§ 8 Abs. 2a).
      await entry(youth.id, '08:00', '12:00', '2026-09-30');
      await entry(youth.id, '12:30', '17:00', '2026-09-30');
      await entry(youth.id, '08:00', '12:00', '2026-10-01');
      await entry(youth.id, '12:30', '16:00', '2026-10-01');
      const week = (
        await get(`/api/time/week?week=2026-W40&employeeId=${youth.id}`, admin.cookie).expect(200)
      ).body as WeekView;
      const inWeek = week.days
        .find((d) => d.date === '2026-09-30')!
        .flags.find((f) => f.code === 'YOUTH_DAY_8H');
      expect(inWeek?.level).toBe('warn');
      const checks = (
        await get('/api/checks?from=2026-09-01&to=2026-09-30', admin.cookie).expect(200)
      ).body as ChecksView;
      expect(
        checks.findings.find((f) => f.date === '2026-09-30' && f.code === 'YOUTH_DAY_8H')?.level,
      ).toBe('warn');
    });
  });

  describe('Zeitprüfung', () => {
    it('meldet Jugendverstöße mit Paragraf und lässt die mildere ArbZG-Meldung weg', async () => {
      await entry(youth.id, '12:00', '20:30');
      const codes = (await flagsOn(youth.id, '2026-10-12')).map((f) => f.code);
      expect(codes).toEqual(
        expect.arrayContaining(['YOUTH_NIGHT', 'YOUTH_DAY_8H', 'YOUTH_BREAK', 'YOUTH_NO_BREAK_45']),
      );
      expect(codes).not.toContain('OVER_8H');
      expect(codes).not.toContain('NO_BREAK_6H');
      await entry(adult.id, '12:00', '20:30');
      expect((await flagsOn(adult.id, '2026-10-12')).map((f) => f.code)).not.toContain(
        'YOUTH_NIGHT',
      );
      const checks = (await get('/api/checks', admin.cookie).expect(200)).body as ChecksView;
      expect(
        checks.findings.find((f) => f.employeeName === 'Paula Jung' && f.code === 'YOUTH_NIGHT'),
      ).toMatchObject({ paragraph: '§ 14 Abs. 1 JArbSchG' });
    });

    it('erlaubt Vollzeitschulpflichtigen Arbeit nur in den Schulferien', async () => {
      await ctx.prisma.employee.update({
        where: { id: youth.id },
        data: { fullTimeSchoolUntil: fromLocalDate('2027-07-31') },
      });
      await entry(youth.id, '09:00', '12:00');
      expect((await flagsOn(youth.id, '2026-10-12')).map((f) => f.code)).toContain(
        'YOUTH_SCHOOL_TERM',
      );
      await send('post', '/api/school-holidays', admin.cookie)
        .send({ name: 'Herbstferien', from: '2026-10-12', to: '2026-10-16' })
        .expect(201);
      expect((await flagsOn(youth.id, '2026-10-12')).map((f) => f.code)).not.toContain(
        'YOUTH_SCHOOL_TERM',
      );
    });
  });

  describe('Schulferien', () => {
    it('lässt alle lesen und nur den Admin pflegen', async () => {
      await send('post', '/api/school-holidays', lead.cookie)
        .send({ name: 'Herbstferien', from: '2026-11-02', to: '2026-11-06' })
        .expect(403);
      const created = await send('post', '/api/school-holidays', admin.cookie)
        .send({ name: 'Herbstferien', from: '2026-11-02', to: '2026-11-06' })
        .expect(201);
      const list = await get('/api/school-holidays?year=2026', youth.cookie).expect(200);
      expect(list.body).toEqual([
        expect.objectContaining({ name: 'Herbstferien', from: '2026-11-02', to: '2026-11-06' }),
      ]);
      await send('patch', `/api/school-holidays/${created.body.id}`, admin.cookie)
        .send({ active: false })
        .expect(200);
      await send('delete', `/api/school-holidays/${created.body.id}`, lead.cookie).expect(403);
      await send('delete', `/api/school-holidays/${created.body.id}`, admin.cookie).expect(204);
      await send('post', '/api/school-holidays', admin.cookie)
        .send({ name: 'Falsch', from: '2026-11-06', to: '2026-11-02' })
        .expect(400);
    });
  });

  describe('Schulferien doppelt (Review Web Phase 7, Befund 2)', () => {
    it('legt denselben Zeitraum auch bei parallelen Anfragen nur einmal an', async () => {
      const body = { name: 'Herbstferien', from: '2026-11-02', to: '2026-11-06' };
      const results = await Promise.all(
        [1, 2, 3].map(() => send('post', '/api/school-holidays', admin.cookie).send(body)),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(results.find((r) => r.status === 409)?.body.message).toBe(
        'Diese Schulferien sind schon angelegt.',
      );
      expect(await ctx.prisma.schoolHoliday.count()).toBe(1);
    });

    it('lehnt eine Änderung auf einen schon angelegten Zeitraum ab', async () => {
      await send('post', '/api/school-holidays', admin.cookie)
        .send({ name: 'Herbstferien', from: '2026-11-02', to: '2026-11-06' })
        .expect(201);
      const other = await send('post', '/api/school-holidays', admin.cookie)
        .send({ name: 'Buß- und Bettag', from: '2026-11-18', to: '2026-11-18' })
        .expect(201);
      await send('patch', `/api/school-holidays/${other.body.id}`, admin.cookie)
        .send({ from: '2026-11-02', to: '2026-11-06' })
        .expect(409);
    });
  });

  describe('Vorwarnung', () => {
    it('zeigt Jugendlichen in Heute spätesten Feierabend und späteste Pause', async () => {
      await entry(youth.id, '08:00', null);
      ctx.clock.set('2026-10-12T07:00:00.000Z'); // 09:00
      const today = (await get('/api/time/today', youth.cookie).expect(200)).body as TodayView;
      expect(today.youthLimits).toEqual({ latestEnd: '16:00', latestBreak: '12:30' });
      await entry(adult.id, '08:00', null);
      const forAdult = (await get('/api/time/today', adult.cookie).expect(200)).body as TodayView;
      expect(forAdult.youthLimits).toBeNull();
    });

    it('erinnert kurz vor der Pause und vor dem Feierabend genau einmal, nur die Person', async () => {
      await entry(youth.id, '08:00', null);
      for (const p of [admin, lead, adult]) await entry(p.id, '07:00', '07:30');
      const reminders = ctx.app.get(RemindersService);
      ctx.clock.set('2026-10-12T10:14:00.000Z'); // 12:14
      expect(await reminders.runOnce()).toBe(0);
      ctx.clock.set('2026-10-12T10:15:00.000Z'); // 12:15
      expect(await reminders.runOnce()).toBe(1);
      expect(await reminders.runOnce()).toBe(0);
      ctx.clock.set('2026-10-12T13:45:00.000Z'); // 15:45
      expect(await reminders.runOnce()).toBe(1);
      expect(await reminders.runOnce()).toBe(0);
      const kinds = (
        await ctx.prisma.reminderLog.findMany({ where: { employeeId: youth.id } })
      ).map((l) => l.kind);
      expect(kinds.sort()).toEqual(['YOUTH_BREAK', 'YOUTH_END']);
      expect(ctx.mail.sent.every((m) => m.to === youth.email)).toBe(true);
    });
  });
});
