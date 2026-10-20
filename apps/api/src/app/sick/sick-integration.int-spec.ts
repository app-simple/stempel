import type { LeaveCalendarView, SickChecksView, TeamTodayRow, WeekView } from '@as/shared';
import { fromLocalDate } from '../common/dates';
import { RemindersService } from '../reminders/reminders.service';
import { RetentionService } from '../checks/retention.service';
import { approvedAbsences } from '../leave/leave-context';
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
 * Einbindung der Krankmeldungen (Spezifikation Phase 6, Abschnitte 5, 6, 8, 9): Zeitkonto, Kalender,
 * „Team heute“, Erinnerungen, Rückbuchung bei Urlaubsänderungen, Prüfungen, Löschjob.
 * Heute ist Mittwoch, 14.10.2026, 10:00 Uhr in Berlin.
 */
describe('Krankmeldungen: Einbindung', () => {
  let ctx: TestContext;
  type Person = { id: string; email: string; cookie: string };
  let admin: Person;
  let lead: Person;
  let emp: Person;
  let peer: Person;
  let other: Person;

  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.clock.set('2026-10-14T08:00:00.000Z');
    ctx.mail.sent.length = 0;
    ctx.push.sent.length = 0;
    await seedLegalParameters(ctx.prisma);
    const person = async (seed: Parameters<typeof createEmployee>[1]): Promise<Person> => {
      const p = await createEmployee(ctx.prisma, seed);
      return { ...p, cookie: await sessionCookie(ctx, p.id) };
    };
    admin = await person({ role: 'ADMIN', name: 'Admin' });
    lead = await person({ role: 'LEAD', leadId: admin.id, name: 'Tobias Lechner' });
    emp = await person({ leadId: lead.id, name: 'Elif Aydin' });
    peer = await person({ leadId: lead.id, name: 'Jonas Reitberger' });
    other = await person({ leadId: admin.id, name: 'Lena Hofbauer' });
  });

  const send = (method: 'post' | 'patch' | 'put', path: string, cookie: string) =>
    http(ctx)[method](path).set('Origin', ORIGIN).set('Cookie', cookie);
  const get = (path: string, cookie: string) => http(ctx).get(path).set('Cookie', cookie);
  const sick = (employeeId: string, from: string, to: string, extra: object = {}) =>
    ctx.prisma.sickLeave.create({
      data: {
        employeeId,
        kind: 'SICK',
        from: fromLocalDate(from),
        to: fromLocalDate(to),
        reportedAt: new Date(),
        reportedById: employeeId,
        ...extra,
      },
    });
  const credit = async (employeeId: string) =>
    (
      await ctx.prisma.leaveLedgerEntry.aggregate({
        where: { employeeId, kind: 'SICK_CREDIT' },
        _sum: { halfDays: true },
      })
    )._sum.halfDays ?? 0;

  describe('Zeitkonto', () => {
    it('setzt das Soll an Krankheitstagen auf 0 und zeigt „krank“ der Person und der Vorgesetzten', async () => {
      await sick(emp.id, '2026-10-12', '2026-10-13');
      for (const [cookie, query] of [
        [emp.cookie, ''],
        [lead.cookie, `&employeeId=${emp.id}`],
      ] as const) {
        const week = (await get(`/api/time/week?week=2026-W42${query}`, cookie).expect(200))
          .body as WeekView;
        const monday = week.days.find((d) => d.date === '2026-10-12')!;
        expect(monday).toMatchObject({
          absence: { type: 'SICK', half: false },
          targetMinutes: 0,
          balanceMinutes: 0,
          missing: false,
        });
      }
    });

    it('lässt am Tag des Heimgehens die Buchung offen; nach dem Ausstempeln gilt der Tag als erfüllt (Review Focus 4)', async () => {
      await send('post', '/api/time/clock/in', emp.cookie).expect(200);
      ctx.clock.set('2026-10-14T10:00:00.000Z');
      await send('post', '/api/sick', emp.cookie)
        .send({ kind: 'SICK', from: '2026-10-14', to: '2026-10-14', sinceNow: true })
        .expect(201);
      expect(await ctx.prisma.timeEntry.count({ where: { employeeId: emp.id, endAt: null } })).toBe(
        1,
      );
      ctx.clock.set('2026-10-14T10:05:00.000Z');
      await send('post', '/api/time/clock/out', emp.cookie).expect(200);
      const week = (await get('/api/time/week?week=2026-W42', emp.cookie).expect(200))
        .body as WeekView;
      const today = week.days.find((d) => d.date === '2026-10-14')!;
      expect(today.absence).toMatchObject({ type: 'SICK', sinceLocal: '12:00' });
      expect(today.targetMinutes).toBe(today.workMinutes);
      expect(today.balanceMinutes).toBe(0);
      expect(today.flags.map((f) => f.code)).not.toContain('ABSENCE_WORK');
    });
  });

  describe('Kalender und Team', () => {
    it('zeigt Krankheit im Kalender nur als Abwesenheit ohne Art und zählt sie für Kollegen', async () => {
      await sick(emp.id, '2026-10-14', '2026-10-14', { kind: 'CHILD_SICK' });
      const colleague = await get('/api/leave/calendar?month=2026-10', peer.cookie).expect(200);
      expect(JSON.stringify(colleague.body)).not.toMatch(/SICK|krank/i);
      const index = (colleague.body as LeaveCalendarView).days.findIndex(
        (d) => d.date === '2026-10-14',
      );
      expect((colleague.body as LeaveCalendarView).teamAbsentCounts?.[index]).toBe(1);
      const forLead = (await get('/api/leave/calendar?month=2026-10', lead.cookie).expect(200))
        .body as LeaveCalendarView;
      const row = forLead.rows.find((r) => r.employeeId === emp.id)!;
      expect(row.cells[index]).toEqual({ status: 'APPROVED', half: false });
      expect(JSON.stringify(forLead)).not.toMatch(/SICK/);
    });

    it('zeigt Vorgesetzten in „Team heute“ „krank“', async () => {
      await sick(emp.id, '2026-10-14', '2026-10-15');
      const rows = (await get('/api/time/team-today', lead.cookie).expect(200))
        .body as TeamTodayRow[];
      expect(rows.find((r) => r.employeeId === emp.id)?.presence).toBe('SICK');
    });

    it('benachrichtigt bei kranker Vorgesetzter die Vertretung', async () => {
      await ctx.prisma.employee.update({ where: { id: emp.id }, data: { deputyId: peer.id } });
      await sick(lead.id, '2026-10-13', '2026-10-16');
      await send('post', '/api/sick', emp.cookie)
        .send({ kind: 'SICK', from: '2026-10-14', to: '2026-10-14' })
        .expect(201);
      expect(ctx.mail.sent.map((m) => m.to)).toEqual([peer.email]);
    });
  });

  describe('Erinnerungen', () => {
    it('erinnert an Krankheitstagen nicht ans Stempeln, aber einmal an die fällige AU', async () => {
      await sick(emp.id, '2026-10-08', '2026-10-15');
      for (const p of [admin, lead, peer, other])
        await ctx.prisma.timeEntry.create({
          data: {
            employeeId: p.id,
            workDate: fromLocalDate('2026-10-14'),
            startAt: new Date('2026-10-14T05:00:00Z'),
            endAt: new Date('2026-10-14T05:30:00Z'),
            source: 'CLOCK',
            recordedAt: new Date('2026-10-14T05:00:00Z'),
            recordedById: p.id,
          },
        });
      const reminders = ctx.app.get(RemindersService);
      expect(await reminders.runOnce()).toBe(1);
      expect(await reminders.runOnce()).toBe(0);
      const mails = ctx.mail.sent.filter((m) => m.to === emp.email);
      expect(mails).toHaveLength(1);
      expect(mails[0]?.text).toContain('Bitte reiche deine Arbeitsunfähigkeitsbescheinigung ein.');
      expect(mails[0]?.text).not.toMatch(/krank/i);
      const logs = await ctx.prisma.reminderLog.findMany({ where: { employeeId: emp.id } });
      expect(logs.map((l) => l.kind)).toEqual(['CERTIFICATE']);
    });

    it('erinnert nicht, wenn die AU vermerkt ist', async () => {
      await sick(emp.id, '2026-10-08', '2026-10-15', {
        certificateUntil: fromLocalDate('2026-10-15'),
        certificateAt: new Date(),
        certificateById: lead.id,
      });
      await ctx.app.get(RemindersService).runOnce();
      expect(
        await ctx.prisma.reminderLog.count({ where: { employeeId: emp.id, kind: 'CERTIFICATE' } }),
      ).toBe(0);
    });
  });

  describe('Rückbuchung bei Urlaubsänderungen', () => {
    it('bucht zurück, wenn der Urlaub erst nach der AU genehmigt wird, und gegen, wenn er storniert wird (Review Focus 2)', async () => {
      await sick(emp.id, '2026-10-20', '2026-10-21', {
        certificateUntil: fromLocalDate('2026-10-21'),
        certificateAt: new Date(),
        certificateById: lead.id,
      });
      const created = await send('post', '/api/leave/requests', emp.cookie)
        .send({
          type: 'VACATION',
          from: '2026-10-19',
          to: '2026-10-23',
          startHalf: false,
          endHalf: false,
        })
        .expect(201);
      expect(await credit(emp.id)).toBe(0);
      await send('post', `/api/leave/requests/${created.body.id}/approve`, lead.cookie).expect(200);
      expect(await credit(emp.id)).toBe(4);
      await send('post', `/api/leave/requests/${created.body.id}/cancellation`, emp.cookie).expect(
        200,
      );
      await send(
        'post',
        `/api/leave/requests/${created.body.id}/cancellation/approve`,
        lead.cookie,
      ).expect(200);
      expect(await credit(emp.id)).toBe(0);
    });
  });

  describe('Prüfungen', () => {
    it('zeigt „AU fehlt“ der Vorgesetzten für ihr Team, sechs Wochen und Jahressummen nur dem Admin', async () => {
      await sick(emp.id, '2026-10-08', '2026-10-15');
      await sick(other.id, '2026-08-01', '2026-10-15');
      const forLead = (await get('/api/checks/sick', lead.cookie).expect(200))
        .body as SickChecksView;
      expect(forLead.certificateMissing.map((s) => s.employeeName)).toEqual(['Elif Aydin']);
      expect(forLead.sixWeeks).toBeNull();
      expect(forLead.lastYear).toBeNull();
      const forAdmin = (await get('/api/checks/sick', admin.cookie).expect(200))
        .body as SickChecksView;
      expect(forAdmin.certificateMissing.map((s) => s.employeeName).sort()).toEqual([
        'Elif Aydin',
        'Lena Hofbauer',
      ]);
      expect(forAdmin.sixWeeks).toEqual([
        {
          employeeId: other.id,
          employeeName: 'Lena Hofbauer',
          from: '2026-08-01',
          reachedOn: '2026-09-11',
        },
      ]);
      expect(forAdmin.lastYear?.find((r) => r.employeeId === other.id)).toMatchObject({
        sickDays: 75,
        childSickDays: 0,
      });
      await get('/api/checks/sick', emp.cookie).expect(403);
    });
  });

  describe('Löschjob', () => {
    it('neutralisiert Krankmeldungen am Ende des Folgejahres und löscht sie bei Anonymisierung', async () => {
      const old = await sick(emp.id, '2024-12-30', '2024-12-31', {
        certificateUntil: fromLocalDate('2024-12-31'),
        certificateAt: new Date(),
        certificateById: lead.id,
      });
      const recent = await sick(emp.id, '2025-03-02', '2025-03-03');
      const leaver = await ctx.prisma.employee.create({
        data: {
          name: 'Früher hier',
          loginEmail: 'frueher@example.com',
          role: 'EMPLOYEE',
          leadId: lead.id,
          entryDate: fromLocalDate('2019-01-01'),
          exitDate: fromLocalDate('2020-12-31'),
        },
      });
      await sick(leaver.id, '2020-06-01', '2020-06-02');
      await ctx.prisma.companySettings.upsert({
        where: { id: 1 },
        create: { retentionEnabled: true },
        update: { retentionEnabled: true },
      });
      await ctx.app.get(RetentionService).runOnce();
      expect(await ctx.prisma.sickLeave.findUnique({ where: { id: old.id } })).toMatchObject({
        kind: 'NEUTRAL',
        reportedById: null,
        certificateUntil: null,
        certificateById: null,
      });
      expect((await ctx.prisma.sickLeave.findUnique({ where: { id: recent.id } }))?.kind).toBe(
        'SICK',
      );
      expect(await ctx.prisma.sickLeave.count({ where: { employeeId: leaver.id } })).toBe(0);
      // Neutral zählt im Zeitkonto weiter als Abwesenheit, nur ohne Art.
      const absences = await approvedAbsences(ctx.prisma, [emp.id], '2024-12-30', '2025-03-03');
      expect(absences.get(emp.id)?.get('2024-12-31')).toEqual({
        type: 'NEUTRAL',
        half: false,
        sinceMinute: null,
      });
      expect(absences.get(emp.id)?.get('2025-03-03')?.type).toBe('SICK');
    });
  });

  describe('Codex-Review API Phase 6', () => {
    const certified = (employeeId: string, from: string, to: string) =>
      sick(employeeId, from, to, {
        certificateUntil: fromLocalDate(to),
        certificateAt: new Date(),
        certificateById: lead.id,
      });
    const approvedLeave = (employeeId: string, type: string, from: string, to: string) =>
      ctx.prisma.leaveRequest.create({
        data: {
          employeeId,
          type: type as 'VACATION',
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

    it('entfernt bei der Neutralisierung auch die Audit-Einträge, auch ohne Löschschalter (Befund 1)', async () => {
      const created = await send('post', '/api/sick', emp.cookie)
        .send({ kind: 'CHILD_SICK', from: '2026-10-14', to: '2026-10-14' })
        .expect(201);
      expect(await ctx.prisma.auditLog.count({ where: { entityId: created.body.id } })).toBe(1);
      ctx.clock.set('2028-01-02T08:00:00.000Z');
      await ctx.app.get(RetentionService).runOnce();
      expect(
        (await ctx.prisma.sickLeave.findUnique({ where: { id: created.body.id } }))?.kind,
      ).toBe('NEUTRAL');
      expect(await ctx.prisma.auditLog.count({ where: { entityId: created.body.id } })).toBe(0);
    });

    it('gleicht Rückbuchungen ab, wenn ein Feiertag oder der Vertrag sich ändert (Befund 2)', async () => {
      await approvedLeave(emp.id, 'VACATION', '2026-10-19', '2026-10-23');
      const leave = await certified(emp.id, '2026-10-20', '2026-10-21');
      await ctx.prisma.$transaction(async (tx) => {
        const { reconcileSickCredit } = await import('./sick-credit');
        await reconcileSickCredit(tx, emp.id, leave.id, lead.id);
      });
      expect(await credit(emp.id)).toBe(4);
      const holiday = await send('post', '/api/holidays', admin.cookie)
        .send({ date: '2026-10-20', name: 'Betriebsfeier' })
        .expect(201);
      expect(await credit(emp.id)).toBe(2);
      await send('patch', `/api/holidays/${holiday.body.id}`, admin.cookie)
        .send({ active: false })
        .expect(200);
      expect(await credit(emp.id)).toBe(4);
      // Ab 21.10. nur noch Montag und Freitag: der Mittwoch ist kein Urlaubstag mehr.
      await send('post', `/api/employees/${emp.id}/terms`, admin.cookie)
        .send({
          validFrom: '2026-10-21',
          type: 'PART_TIME',
          weeklyMinutes: 960,
          workDays: [1, 5],
          annualLeaveDays: 30,
          extraLeaveDays: 0,
          hourlyWageCents: null,
        })
        .expect(201);
      expect(await credit(emp.id)).toBe(2);
    });

    it('verweigert Änderungen an neutralisierten Krankmeldungen (Befund 3)', async () => {
      const old = await sick(emp.id, '2024-12-30', '2024-12-31', { kind: 'NEUTRAL' });
      await send('put', `/api/sick/${old.id}/certificate`, admin.cookie)
        .send({ until: '2024-12-31' })
        .expect(404);
      expect(
        (await ctx.prisma.sickLeave.findUnique({ where: { id: old.id } }))?.certificateUntil,
      ).toBeNull();
    });

    it('erinnert an einem Krankheitstag auch an eine offene Buchung vom Vortag nicht (Befund 4)', async () => {
      await ctx.prisma.timeEntry.create({
        data: {
          employeeId: emp.id,
          workDate: fromLocalDate('2026-10-13'),
          startAt: new Date('2026-10-13T06:00:00Z'),
          source: 'CLOCK',
          recordedAt: new Date('2026-10-13T06:00:00Z'),
          recordedById: emp.id,
        },
      });
      await sick(emp.id, '2026-10-14', '2026-10-14');
      await ctx.app.get(RemindersService).runOnce();
      expect(
        await ctx.prisma.reminderLog.count({ where: { employeeId: emp.id, kind: 'CLOCK_OUT' } }),
      ).toBe(0);
      const banner = await get('/api/reminders/today', emp.cookie).expect(200);
      expect(banner.body.clockOutDue).toBe(false);
    });

    it('erinnert bei langer Krankheit über Neujahr genau einmal an die AU (Befund 5)', async () => {
      await sick(emp.id, '2026-12-29', '2027-03-31');
      const reminders = ctx.app.get(RemindersService);
      ctx.clock.set('2027-01-04T08:00:00.000Z');
      await reminders.runOnce();
      ctx.clock.set('2027-03-03T08:00:00.000Z');
      await reminders.runOnce();
      expect(
        await ctx.prisma.reminderLog.count({ where: { employeeId: emp.id, kind: 'CERTIFICATE' } }),
      ).toBe(1);
    });

    it('berücksichtigt bei der AU-Fälligkeit einen Vertragswechsel in der Krankheit (Befund 6)', async () => {
      await ctx.prisma.employmentTerms.create({
        data: {
          employeeId: emp.id,
          validFrom: fromLocalDate('2026-10-19'),
          type: 'PART_TIME',
          weeklyMinutes: 960,
          workDays: [2, 4],
          annualLeaveDays: 30,
        },
      });
      await sick(emp.id, '2026-10-16', '2026-10-21');
      const list = (await get('/api/sick', lead.cookie).expect(200)).body as {
        certificateDue: string;
      }[];
      expect(list[0]?.certificateDue).toBe('2026-10-20');
    });

    it('zeigt dem Admin die Einstellung „AU ab dem 1. Tag“ (Befund 7)', async () => {
      await send('patch', `/api/employees/${emp.id}/certificate-from-day1`, admin.cookie)
        .send({ value: true })
        .expect(200);
      const employee = await get(`/api/employees/${emp.id}`, admin.cookie).expect(200);
      expect(employee.body.certificateFromDay1).toBe(true);
    });

    it('weist den Admin auf Krankheit mit AU während Überstundenabbau hin (Befund 8)', async () => {
      await ctx.prisma.employee.update({
        where: { id: emp.id },
        data: { overtimeAccountSince: fromLocalDate('2026-01-01') },
      });
      await approvedLeave(emp.id, 'OVERTIME_OFF', '2026-10-12', '2026-10-13');
      await certified(emp.id, '2026-10-13', '2026-10-13');
      const forAdmin = (await get('/api/checks/sick', admin.cookie).expect(200))
        .body as SickChecksView;
      expect(forAdmin.overtimeOffDuringSickness?.map((s) => s.employeeName)).toEqual([
        'Elif Aydin',
      ]);
      const forLead = (await get('/api/checks/sick', lead.cookie).expect(200))
        .body as SickChecksView;
      expect(forLead.overtimeOffDuringSickness).toBeNull();
    });
  });
});
