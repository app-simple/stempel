import type {
  ChecksView,
  ForfeitureSuggestion,
  LeaveAccountView,
  LeaveNoticeView,
  RetentionSettingsView,
} from '@as/shared';
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
import { ANONYMIZED_NAME, RetentionService } from './retention.service';

/** Prüfungen und Nachweise (Spezifikation Phase 4). Testpersonen: Vollzeit Mo–Fr, 30 Tage Urlaub. */
describe('Prüfungen und Nachweise', () => {
  let ctx: TestContext;
  type Person = { id: string; email: string; cookie: string };
  let admin: Person;
  let lead: Person;
  let emp: Person;
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
    otherLead = await person({ role: 'LEAD', leadId: admin.id, name: 'Miriam Stadler' });
    otherEmp = await person({ leadId: otherLead.id, name: 'Lena Hofbauer' });
  });

  /** Nach einem Zeitsprung sind Sitzungen abgelaufen; neue anlegen. */
  const refreshSessions = async () => {
    for (const p of [admin, lead, emp, otherLead, otherEmp])
      p.cookie = await sessionCookie(ctx, p.id);
  };
  const post = (path: string, cookie: string) =>
    http(ctx).post(path).set('Origin', ORIGIN).set('Cookie', cookie);
  const put = (path: string, cookie: string) =>
    http(ctx).put(path).set('Origin', ORIGIN).set('Cookie', cookie);
  const get = (path: string, cookie: string) => http(ctx).get(path).set('Cookie', cookie);
  const entry = (employeeId: string, date: string, start: string, end: string) =>
    ctx.prisma.timeEntry.create({
      data: {
        employeeId,
        workDate: fromLocalDate(date),
        startAt: new Date(`${date}T${start}:00+02:00`),
        endAt: new Date(`${date}T${end}:00+02:00`),
        source: 'CLOCK',
        recordedAt: new Date(`${date}T${start}:00+02:00`),
        recordedById: employeeId,
      },
    });
  const fullWeeks = async (employeeId: string, from: string, to: string, end = '16:30') => {
    for (
      let d = new Date(`${from}T00:00:00Z`);
      d <= new Date(`${to}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const date = d.toISOString().slice(0, 10);
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) await entry(employeeId, date, '08:00', end);
    }
  };

  describe('Prüfseite', () => {
    it('zeigt Vorgesetzten nur Feststellungen ihres Teams, Mitarbeitern nichts', async () => {
      await entry(emp.id, '2026-10-06', '06:00', '18:00'); // über 10 Std., keine Pause
      await entry(otherEmp.id, '2026-10-06', '06:00', '18:00');
      const view = (await get('/api/checks?from=2026-10-05&to=2026-10-09', lead.cookie).expect(200))
        .body as ChecksView;
      const mine = view.findings.filter(
        (f) => f.date === '2026-10-06' && f.code !== 'MISSING_ENTRY',
      );
      expect(mine.map((f) => f.code)).toEqual(
        expect.arrayContaining(['MAX_10H', 'BREAK_TOO_SHORT', 'NO_BREAK_6H']),
      );
      expect(mine.every((f) => f.employeeName === 'Elif Aydin')).toBe(true);
      expect(JSON.stringify(view)).not.toContain('Lena');
      expect(view.findings).toContainEqual(
        expect.objectContaining({
          code: 'MISSING_ENTRY',
          employeeName: 'Elif Aydin',
          date: '2026-10-05',
          paragraph: 'Erfassungspflicht',
          level: 'warn',
        }),
      );
      await get('/api/checks', emp.cookie).expect(403);
      const all = (await get('/api/checks?from=2026-10-05&to=2026-10-09', admin.cookie).expect(200))
        .body as ChecksView;
      expect(all.findings.some((f) => f.employeeName === 'Lena Hofbauer')).toBe(true);
    });

    it('prüft den Zeitraum', async () => {
      await get('/api/checks?from=2026-10-09&to=2026-10-05', lead.cookie).expect(400);
      await get('/api/checks?from=2025-01-01&to=2026-10-05', lead.cookie).expect(400);
      const view = (await get('/api/checks', lead.cookie).expect(200)).body as ChecksView;
      expect(view).toMatchObject({ from: '2026-08-31', to: '2026-10-12' });
    });

    it('zeigt den Ausgleich nach § 3 ArbZG über 24 Wochen, ohne Abwesenheitstage', async () => {
      // 10 Std. an jedem Tag Mo–Fr: 5 × 600 / 6 Werktage (Mo–Sa) = 500 Minuten im Schnitt.
      await fullWeeks(emp.id, '2026-04-27', '2026-10-11', '18:00');
      const view = (await get('/api/checks', lead.cookie).expect(200)).body as ChecksView;
      const row = view.compensation.find((c) => c.employeeId === emp.id);
      expect(row).toMatchObject({ from: '2026-04-27', to: '2026-10-11', exceeds: true });
      expect(row?.averageMinutes).toBeGreaterThan(480);
      const peer = view.compensation.find((c) => c.employeeId === lead.id);
      expect(peer).toMatchObject({ averageMinutes: 0, exceeds: false });
    });

    it('zeigt Minijobber mit Vor- und laufendem Monat', async () => {
      const mini = await createEmployee(ctx.prisma, {
        leadId: lead.id,
        name: 'Anna Kroiß',
        type: 'MINIJOB',
      });
      await entry(mini.id, '2026-10-06', '08:00', '12:00');
      const view = (await get('/api/checks', lead.cookie).expect(200)).body as ChecksView;
      const row = view.minijob.find((m) => m.employeeId === mini.id);
      expect(row?.months.map((m) => m.month)).toEqual(['2026-09', '2026-10']);
      expect(row?.months[1]?.workMinutes).toBe(240);
    });
  });

  describe('Urlaubshinweis (Entscheidungen 2, 3a)', () => {
    it('versendet an alle ohne Hinweis, per E-Mail und in der Anwendung, mit Lesebestätigung', async () => {
      ctx.clock.set('2026-09-15T08:00:00.000Z');
      const sent = (await post('/api/leave/notices', admin.cookie).send({ year: 2026 }).expect(201))
        .body as LeaveNoticeView[];
      expect(sent).toHaveLength(5);
      const mine = sent.find((n) => n.employeeId === emp.id);
      expect(mine).toMatchObject({
        restHalfDays: 60,
        timelyForYearEnd: true,
        timelyForMarch31: true,
        readAt: null,
      });
      expect(mine?.text).toContain('du hast für 2026 noch 30 Urlaubstage');
      expect(mine?.text).toContain('verfällt am 31.12.2026');
      expect(mine?.text).toContain('verfällt er am 31.03.2027');
      await ctx.mail.flush();
      const mail = ctx.mail.sent.find((m) => m.to === emp.email);
      expect(mail?.subject).toBe('Hinweis zu deinem Resturlaub 2026');
      expect(mail?.text).toBe(mine?.text);
      // Zweiter Versand an alle: niemand ohne Hinweis mehr.
      expect(
        (
          (await post('/api/leave/notices', admin.cookie).send({ year: 2026 }).expect(201))
            .body as unknown[]
        ).length,
      ).toBe(0);

      const own = (await get('/api/leave/notices', emp.cookie).expect(200))
        .body as LeaveNoticeView[];
      expect(own.map((n) => n.employeeId)).toEqual([emp.id]);
      await post(`/api/leave/notices/${mine?.id}/read`, lead.cookie).expect(404);
      const read = (await post(`/api/leave/notices/${mine?.id}/read`, emp.cookie).expect(200))
        .body as LeaveNoticeView;
      expect(read.readAt).not.toBeNull();
      await post(`/api/leave/notices/${mine?.id}/read`, emp.cookie).expect(200);
      await post('/api/leave/notices', lead.cookie).send({ year: 2026 }).expect(403);
    });

    it('wertet einen Hinweis nach dem 30.09. für den 31.12. als verspätet', async () => {
      ctx.clock.set('2026-10-01T08:00:00.000Z');
      const [n] = (
        await post('/api/leave/notices', admin.cookie)
          .send({ year: 2026, employeeIds: [emp.id] })
          .expect(201)
      ).body as LeaveNoticeView[];
      expect(n).toMatchObject({ timelyForYearEnd: false, timelyForMarch31: true });
    });

    it('zeigt den Stand auf der Prüfseite und erinnert ab 1. Juli', async () => {
      const at = async (iso: string) => {
        ctx.clock.set(iso);
        await refreshSessions();
        return ((await get('/api/checks', admin.cookie).expect(200)).body as ChecksView).notices;
      };
      expect(await at('2026-06-30T08:00:00.000Z')).toMatchObject({
        reminder: false,
        yearEndDeadlinePassed: false,
      });
      expect(await at('2026-07-01T08:00:00.000Z')).toMatchObject({
        reminder: true,
        yearEndDeadlinePassed: false,
      });
      expect(await at('2026-09-30T20:00:00.000Z')).toMatchObject({ yearEndDeadlinePassed: false });
      expect(await at('2026-10-01T08:00:00.000Z')).toMatchObject({ yearEndDeadlinePassed: true });
      ctx.clock.set('2026-10-12T08:00:00.000Z');
      await refreshSessions();
      const view = (await get('/api/checks', admin.cookie).expect(200)).body as ChecksView;
      expect(view.notices.reminder).toBe(true);
      expect(view.notices.rows.find((r) => r.employeeId === emp.id)).toMatchObject({
        rest: 60,
        latest: null,
      });
    });
  });

  describe('Verfall (Entscheidung 3)', () => {
    const accountOf = async (year: number) =>
      (await get(`/api/leave/account?employeeId=${emp.id}&year=${year}`, admin.cookie).expect(200))
        .body as LeaveAccountView;

    it('bucht Verfall nur nach rechtzeitigem Hinweis und nur einmal', async () => {
      // 2026: 30 Tage, 25 genommen, 3 übertragen → 2 Tage verfallen am 31.12.2026.
      await ctx.prisma.leaveRequest.create({
        data: {
          employeeId: emp.id,
          type: 'VACATION',
          from: fromLocalDate('2026-07-06'),
          to: fromLocalDate('2026-08-07'),
          halfDays: 50,
          status: 'APPROVED',
          requestedAt: new Date(),
          requestedById: emp.id,
          decidedAt: new Date(),
          decidedById: lead.id,
        },
      });
      await ctx.prisma.leaveCarryOver.create({ data: { employeeId: emp.id, year: 2027, days: 3 } });
      ctx.clock.set('2026-09-15T08:00:00.000Z');
      await post('/api/leave/notices', admin.cookie)
        .send({ year: 2026, employeeIds: [emp.id] })
        .expect(201);

      ctx.clock.set('2027-01-05T08:00:00.000Z');
      await refreshSessions();
      const view = (await get('/api/checks', admin.cookie).expect(200)).body as ChecksView;
      const suggestion = view.forfeitures.find(
        (f) => f.employeeId === emp.id && f.year === 2026 && f.kind === 'YEAR_END',
      );
      expect(suggestion).toMatchObject({
        halfDays: 4,
        noticeTimely: true,
        forfeitsOn: '2026-12-31',
      });
      const lv = (await get('/api/checks', lead.cookie).expect(200)).body as ChecksView;
      expect(lv.forfeitures).toEqual([]);

      await post('/api/leave/forfeitures', lead.cookie)
        .send({ employeeId: emp.id, year: 2026, kind: 'YEAR_END' })
        .expect(403);
      const booked = (
        await post('/api/leave/forfeitures', admin.cookie)
          .send({ employeeId: emp.id, year: 2026, kind: 'YEAR_END' })
          .expect(201)
      ).body as ForfeitureSuggestion;
      expect(booked.halfDays).toBe(4);
      expect((await accountOf(2026)).corrections).toBe(-4);
      await post('/api/leave/forfeitures', admin.cookie)
        .send({ employeeId: emp.id, year: 2026, kind: 'YEAR_END' })
        .expect(409);
      const after = (await get('/api/checks', admin.cookie).expect(200)).body as ChecksView;
      expect(after.forfeitures.some((f) => f.employeeId === emp.id && f.kind === 'YEAR_END')).toBe(
        false,
      );

      // Übertragene 3 Tage, davon 1 bis 31.03.2027 genommen → 2 Tage verfallen am 31.03.2027.
      await ctx.prisma.leaveRequest.create({
        data: {
          employeeId: emp.id,
          type: 'VACATION',
          from: fromLocalDate('2027-02-15'),
          to: fromLocalDate('2027-02-15'),
          halfDays: 2,
          status: 'APPROVED',
          requestedAt: new Date(),
          requestedById: emp.id,
          decidedAt: new Date(),
          decidedById: lead.id,
        },
      });
      await post('/api/leave/forfeitures', admin.cookie)
        .send({ employeeId: emp.id, year: 2026, kind: 'MARCH31' })
        .expect(422);
      ctx.clock.set('2027-04-02T08:00:00.000Z');
      await refreshSessions();
      const march = (
        await post('/api/leave/forfeitures', admin.cookie)
          .send({ employeeId: emp.id, year: 2026, kind: 'MARCH31' })
          .expect(201)
      ).body as ForfeitureSuggestion;
      expect(march).toMatchObject({ halfDays: 4, forfeitsOn: '2027-03-31' });
      expect((await accountOf(2027)).corrections).toBe(-4);
    });

    it('lässt ohne rechtzeitigen Hinweis keinen Verfall zu', async () => {
      ctx.clock.set('2026-11-02T08:00:00.000Z');
      await post('/api/leave/notices', admin.cookie)
        .send({ year: 2026, employeeIds: [emp.id] })
        .expect(201);
      ctx.clock.set('2027-01-05T08:00:00.000Z');
      await refreshSessions();
      const view = (await get('/api/checks', admin.cookie).expect(200)).body as ChecksView;
      expect(
        view.forfeitures.find((f) => f.employeeId === emp.id && f.kind === 'YEAR_END'),
      ).toMatchObject({ halfDays: 60, noticeTimely: false });
      const res = await post('/api/leave/forfeitures', admin.cookie)
        .send({ employeeId: emp.id, year: 2026, kind: 'YEAR_END' })
        .expect(422);
      expect(res.body.message).toContain('Ohne rechtzeitigen Urlaubshinweis');
    });
  });

  describe('Aufbewahrung und Löschjob (Entscheidungen 6, 6a, 8)', () => {
    it('stellt Fristen nur als Admin und nie unter zwei Jahren ein', async () => {
      const defaults = (await get('/api/settings/retention', admin.cookie).expect(200))
        .body as RetentionSettingsView;
      expect(defaults).toEqual({
        enabled: false,
        timeYears: 2,
        payrollYears: 8,
        leaveYears: 3,
        auditYears: 3,
      });
      await get('/api/settings/retention', lead.cookie).expect(403);
      await put('/api/settings/retention', admin.cookie)
        .send({ ...defaults, timeYears: 1 })
        .expect(400);
      await put('/api/settings/retention', admin.cookie)
        .send({ ...defaults, enabled: true })
        .expect(200);
    });

    it('räumt ausgeschaltet nur Technisches auf und löscht eingeschaltet nach Fristen', async () => {
      const testStart = new Date();
      const retention = ctx.app.get(RetentionService);
      const mini = await createEmployee(ctx.prisma, { leadId: lead.id, type: 'MINIJOB' });
      // Vertrag seit 2015, damit die Buchung 2023 ein Minijob-Tag ist.
      await ctx.prisma.employee.update({
        where: { id: mini.id },
        data: { entryDate: fromLocalDate('2015-01-01') },
      });
      await ctx.prisma.employmentTerms.updateMany({
        where: { employeeId: mini.id },
        data: { validFrom: fromLocalDate('2015-01-01') },
      });
      const old = await entry(emp.id, '2023-03-01', '08:00', '12:00');
      const recent = await entry(emp.id, '2024-03-01', '08:00', '12:00');
      const oldMini = await entry(mini.id, '2023-03-02', '08:00', '12:00');
      await ctx.prisma.session.create({
        data: {
          employeeId: emp.id,
          tokenHash: 'abgelaufen',
          method: 'EMAIL_CODE',
          expiresAt: new Date('2026-10-01T00:00:00Z'),
        },
      });
      await ctx.prisma.auditLog.create({
        data: { action: 'alt', at: new Date('2022-05-01T00:00:00Z') },
      });

      const off = await retention.runOnce();
      expect(off).toMatchObject({ technical: 1, timeEntries: 0, auditEntries: 0 });
      expect(await ctx.prisma.timeEntry.count({ where: { id: old.id } })).toBe(1);

      await ctx.prisma.companySettings.upsert({
        where: { id: 1 },
        create: { retentionEnabled: true },
        update: { retentionEnabled: true },
      });
      const on = await retention.runOnce();
      expect(on.timeEntries).toBe(1);
      expect(await ctx.prisma.timeEntry.count({ where: { id: old.id } })).toBe(0);
      expect(await ctx.prisma.timeEntry.count({ where: { id: recent.id } })).toBe(1);
      // Minijob-Zeiten sind Lohnunterlagen (8 Jahre).
      expect(await ctx.prisma.timeEntry.count({ where: { id: oldMini.id } })).toBe(1);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'alt' } })).toBe(0);
      // Das Protokoll wird zwischen Tests nicht geleert; nur Einträge dieses Laufs zählen.
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'retention.purge', at: { gte: testStart } },
        }),
      ).toBe(1);
    });

    it('anonymisiert Ausgeschiedene erst, wenn alle Fristen abgelaufen sind', async () => {
      const retention = ctx.app.get(RetentionService);
      await ctx.prisma.companySettings.upsert({
        where: { id: 1 },
        create: { retentionEnabled: true },
        update: { retentionEnabled: true },
      });
      const exited = async (name: string, exitDate: string) => {
        const p = await createEmployee(ctx.prisma, { name });
        await ctx.prisma.employee.update({
          where: { id: p.id },
          data: { entryDate: fromLocalDate('2015-01-01'), exitDate: fromLocalDate(exitDate) },
        });
        return p;
      };
      const longGone = await exited('Frühere Person', '2017-06-30');
      const recentlyGone = await exited('Kürzlich Ausgetreten', '2022-06-30');
      await ctx.prisma.employmentTerms.updateMany({
        where: { employeeId: recentlyGone.id },
        data: { type: 'MINIJOB', hourlyWageCents: 1400, weeklyMinutes: 480 },
      });
      // Vollzeit, 2022 ausgetreten: Fristen für Zeiten (2) und Urlaub (3) abgelaufen (Befund 10).
      const fullTime = await exited('Vollzeit Ausgetreten', '2022-06-30');
      await retention.runOnce();
      const a = await ctx.prisma.employee.findUniqueOrThrow({
        where: { id: longGone.id },
        include: { terms: true },
      });
      expect(a).toMatchObject({ name: ANONYMIZED_NAME, jobTitle: null });
      expect(a.loginEmail).not.toContain('example');
      expect(a.terms).toHaveLength(0);
      // 2022 mit Minijob: Lohnunterlagen-Frist (8 Jahre) läuft noch.
      const b = await ctx.prisma.employee.findUniqueOrThrow({ where: { id: recentlyGone.id } });
      expect(b.name).toBe('Kürzlich Ausgetreten');
      const c = await ctx.prisma.employee.findUniqueOrThrow({ where: { id: fullTime.id } });
      expect(c.name).toBe(ANONYMIZED_NAME);
    });
  });

  describe('Befunde Codex-Review Phase 4 API', () => {
    const backdate = async (id: string, date: string) => {
      await ctx.prisma.employee.update({
        where: { id },
        data: { entryDate: fromLocalDate(date) },
      });
      await ctx.prisma.employmentTerms.updateMany({
        where: { employeeId: id },
        data: { validFrom: fromLocalDate(date) },
      });
    };
    const enable = () =>
      ctx.prisma.companySettings.upsert({
        where: { id: 1 },
        create: { retentionEnabled: true },
        update: { retentionEnabled: true },
      });

    it('lässt das Überstundenkonto beim Löschen unverändert (Saldovortrag, 1)', async () => {
      await backdate(emp.id, '2023-06-01');
      await ctx.prisma.employee.update({
        where: { id: emp.id },
        data: { overtimeAccountSince: fromLocalDate('2023-06-01') },
      });
      await entry(emp.id, '2023-06-01', '08:00', '18:30'); // 10:30 Std. ohne Pause, +150
      await entry(emp.id, '2024-02-01', '08:00', '17:00'); // +60
      await ctx.prisma.overtimeAdjustment.create({
        data: {
          employeeId: emp.id,
          minutes: 90,
          effectiveOn: fromLocalDate('2023-07-01'),
          reason: 'Altsaldo',
          createdById: admin.id,
        },
      });
      const balance = async () =>
        (await get(`/api/time/overtime?employeeId=${emp.id}`, admin.cookie).expect(200)).body as {
          balanceMinutes: number;
          since: string;
        };
      const before = await balance();
      await enable();
      await ctx.app.get(RetentionService).runOnce();
      const after = await balance();
      expect(after.balanceMinutes).toBe(before.balanceMinutes);
      expect(after.since).toBe('2024-01-01');
      expect(
        await ctx.prisma.timeEntry.count({
          where: { employeeId: emp.id, workDate: { lt: fromLocalDate('2024-01-01') } },
        }),
      ).toBe(0);
    });

    it('rechnet die Protokollfrist ab Jahresbeginn in Berlin (2)', async () => {
      const keep = await ctx.prisma.auditLog.create({
        data: { action: 'grenze', at: new Date('2022-12-31T23:30:00Z') }, // 01.01.2023 00:30 Berlin
      });
      const drop = await ctx.prisma.auditLog.create({
        data: { action: 'grenze', at: new Date('2022-12-31T22:30:00Z') }, // 31.12.2022 23:30 Berlin
      });
      await enable();
      await ctx.app.get(RetentionService).runOnce();
      expect(await ctx.prisma.auditLog.count({ where: { id: keep.id } })).toBe(1);
      expect(await ctx.prisma.auditLog.count({ where: { id: drop.id } })).toBe(0);
    });

    it('nimmt den letzten Hinweis vor dem Verfallstag und begrenzt auf dessen Rest (4)', async () => {
      const notice = (sentAt: string, restHalfDays: number) =>
        ctx.prisma.leaveNotice.create({
          data: {
            employeeId: emp.id,
            year: 2026,
            restHalfDays,
            text: 'Hinweis',
            sentAt: new Date(sentAt),
            sentById: admin.id,
          },
        });
      await notice('2026-09-01T08:00:00Z', 10);
      ctx.clock.set('2027-01-05T08:00:00.000Z');
      await refreshSessions();
      let view = (await get('/api/checks', admin.cookie).expect(200)).body as ChecksView;
      expect(
        view.forfeitures.find((f) => f.employeeId === emp.id && f.kind === 'YEAR_END'),
      ).toMatchObject({
        halfDays: 10,
        noticeTimely: true,
      });
      // Ein späterer, verspäteter Hinweis ist maßgeblich: kein Verfall mehr.
      await notice('2026-11-15T08:00:00Z', 60);
      view = (await get('/api/checks', admin.cookie).expect(200)).body as ChecksView;
      expect(
        view.forfeitures.find((f) => f.employeeId === emp.id && f.kind === 'YEAR_END'),
      ).toMatchObject({
        noticeTimely: false,
      });
      await post('/api/leave/forfeitures', admin.cookie)
        .send({ employeeId: emp.id, year: 2026, kind: 'YEAR_END' })
        .expect(422);
    });

    it('erfasst die E-Mail-Zustellung getrennt; ein Versandfehler bleibt sichtbar (8)', async () => {
      const spy = jest.spyOn(ctx.mail, 'send').mockRejectedValueOnce(new Error('SMTP'));
      const [n] = (
        await post('/api/leave/notices', admin.cookie)
          .send({ year: 2026, employeeIds: [emp.id] })
          .expect(201)
      ).body as LeaveNoticeView[];
      spy.mockRestore();
      expect(n?.emailSentAt).toBeNull();
      const [ok] = (
        await post('/api/leave/notices', admin.cookie)
          .send({ year: 2026, employeeIds: [emp.id] })
          .expect(201)
      ).body as LeaveNoticeView[];
      expect(ok?.emailSentAt).not.toBeNull();
    });

    it('zeigt Minijob-Monate auch bei Wechsel mitten im Monat (11)', async () => {
      await ctx.prisma.employmentTerms.create({
        data: {
          employeeId: emp.id,
          validFrom: fromLocalDate('2026-10-15'),
          type: 'MINIJOB',
          weeklyMinutes: 480,
          workDays: [1, 2, 3, 4, 5],
          annualLeaveDays: 20,
          hourlyWageCents: 1400,
        },
      });
      ctx.clock.set('2026-10-20T08:00:00.000Z');
      await refreshSessions();
      await entry(emp.id, '2026-10-16', '08:00', '11:00');
      const view = (await get('/api/checks', lead.cookie).expect(200)).body as ChecksView;
      const row = view.minijob.find((m) => m.employeeId === emp.id);
      expect(row?.months.map((m) => [m.month, m.workMinutes])).toEqual([['2026-10', 180]]);
    });

    it('nimmt halbe Abwesenheitstage aus dem Ausgleich (13)', async () => {
      const workdays = async () =>
        ((await get('/api/checks', lead.cookie).expect(200)).body as ChecksView).compensation.find(
          (c) => c.employeeId === emp.id,
        )?.workdays ?? 0;
      const before = await workdays();
      await ctx.prisma.leaveRequest.create({
        data: {
          employeeId: emp.id,
          type: 'VACATION',
          from: fromLocalDate('2026-09-02'),
          to: fromLocalDate('2026-09-02'),
          startHalf: true,
          halfDays: 1,
          status: 'APPROVED',
          requestedAt: new Date(),
          requestedById: emp.id,
          decidedAt: new Date(),
          decidedById: lead.id,
        },
      });
      expect(await workdays()).toBe(before - 1);
    });
  });
});
