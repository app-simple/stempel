import type {
  ClockResult,
  CorrectionResult,
  EntrySaveResult,
  TodayView,
  WeekView,
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

/** Zeiterfassung (Spezifikation Phase 2). Uhr: FakeClock, Zeiten in UTC; Berlin = UTC+2 bis 25.10.2026. */
describe('Zeiterfassung', () => {
  let ctx: TestContext;
  let admin: { id: string; cookie: string };
  let lead: { id: string; cookie: string };
  let emp: { id: string; cookie: string };
  let other: { id: string; cookie: string };

  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.clock.set('2026-10-12T06:00:00.000Z'); // Mo 08:00
    await seedLegalParameters(ctx.prisma);
    const a = await createEmployee(ctx.prisma, { role: 'ADMIN', name: 'Admin' });
    const l = await createEmployee(ctx.prisma, { role: 'LEAD', leadId: a.id, name: 'Lead' });
    const e = await createEmployee(ctx.prisma, { leadId: l.id, name: 'Jonas' });
    const o = await createEmployee(ctx.prisma, { leadId: a.id, name: 'Andere' });
    admin = { id: a.id, cookie: await sessionCookie(ctx, a.id) };
    lead = { id: l.id, cookie: await sessionCookie(ctx, l.id) };
    emp = { id: e.id, cookie: await sessionCookie(ctx, e.id) };
    other = { id: o.id, cookie: await sessionCookie(ctx, o.id) };
  });

  const post = (path: string, cookie: string) =>
    http(ctx).post(path).set('Origin', ORIGIN).set('Cookie', cookie);
  const get = (path: string, cookie: string) => http(ctx).get(path).set('Cookie', cookie);
  const manual = (cookie: string, body: object) =>
    post('/api/time/entries', cookie).send({ breaks: [], reason: 'Stempeln vergessen', ...body });

  describe('Stempeluhr', () => {
    it('stempelt mit Serverzeit: Kommen, Pause, Gehen', async () => {
      await post('/api/time/clock/in', emp.cookie).expect(200);
      ctx.clock.set('2026-10-12T10:00:00.000Z');
      const pause = (await post('/api/time/clock/break-start', emp.cookie).expect(200))
        .body as ClockResult;
      expect(pause.today).toMatchObject({ state: 'PAUSE', since: '12:00' });
      ctx.clock.set('2026-10-12T10:30:00.000Z');
      await post('/api/time/clock/break-end', emp.cookie).expect(200);
      ctx.clock.set('2026-10-12T14:30:00.000Z');
      const out = (await post('/api/time/clock/out', emp.cookie).expect(200)).body as ClockResult;
      expect(out.today.state).toBe('OUT');
      expect(out.today.workedMinutes).toBe(480);
      expect(out.flags).toEqual([]);
      const [entry] = out.today.entries;
      expect(entry).toMatchObject({
        startLocal: '08:00',
        endLocal: '16:30',
        source: 'CLOCK',
        breakMinutes: 30,
        late: null,
      });
    });

    it('meldet fehlende Pausen, blockiert aber nicht, und protokolliert den Verstoß', async () => {
      await post('/api/time/clock/in', emp.cookie).expect(200);
      ctx.clock.set('2026-10-12T13:01:00.000Z'); // 7:01 Std. ohne Pause
      const out = (await post('/api/time/clock/out', emp.cookie).expect(200)).body as ClockResult;
      expect(out.flags.map((f) => f.code)).toEqual(['BREAK_TOO_SHORT', 'NO_BREAK_6H']);
      const audit = await ctx.prisma.auditLog.findFirst({
        where: { action: 'time.violation', entityId: emp.id },
        orderBy: { id: 'desc' },
      });
      expect(audit?.details).toEqual({
        date: '2026-10-12',
        codes: ['BREAK_TOO_SHORT', 'NO_BREAK_6H'],
      });
    });

    it('erzeugt auch bei parallelen Klicks nur eine laufende Buchung', async () => {
      const results = await Promise.all(
        [1, 2, 3].map(() => post('/api/time/clock/in', emp.cookie)),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(await ctx.prisma.timeEntry.count({ where: { employeeId: emp.id } })).toBe(1);
    });

    it('nimmt keine Uhrzeit vom Gerät an', async () => {
      await post('/api/time/clock/in', emp.cookie)
        .send({ at: '2026-10-12T04:00:00.000Z' })
        .expect(200);
      const entry = await ctx.prisma.timeEntry.findFirstOrThrow({ where: { employeeId: emp.id } });
      expect(entry.startAt.toISOString()).toBe('2026-10-12T06:00:00.000Z');
    });
  });

  describe('Nachtrag', () => {
    it('markiert den Nachtrag mit Erfassungszeit und Verzug', async () => {
      ctx.clock.set('2026-10-12T08:04:00.000Z'); // 10:04
      const res = (
        await manual(emp.cookie, { date: '2026-10-12', start: '08:00', end: null }).expect(201)
      ).body as EntrySaveResult;
      expect(res.entry).toMatchObject({
        source: 'MANUAL',
        recordedAtLocal: '10:04',
        late: { daysLate: 0, minutesAfterStart: 124 },
        recordedByName: null,
      });
      const today = (await get('/api/time/today', emp.cookie).expect(200)).body as TodayView;
      expect(today).toMatchObject({ state: 'IN', since: '08:00' });
    });

    it('verlangt Begründung, lehnt Zukunft, fehlendes Ende früherer Tage und Überschneidungen ab', async () => {
      await post('/api/time/entries', emp.cookie)
        .send({ date: '2026-10-09', start: '08:00', end: '16:00', breaks: [], reason: ' ' })
        .expect(400);
      await manual(emp.cookie, { date: '2026-10-13', start: '08:00', end: '16:00' }).expect(400);
      await manual(emp.cookie, { date: '2026-10-09', start: '08:00', end: null }).expect(400);
      await manual(emp.cookie, { date: '2026-10-09', start: '08:00', end: '12:00' }).expect(201);
      const overlap = await manual(emp.cookie, {
        date: '2026-10-09',
        start: '11:00',
        end: '13:00',
      }).expect(409);
      expect(overlap.body.message).toBe('Die Zeit überschneidet sich mit einer anderen Buchung.');
      await manual(emp.cookie, { date: '2026-10-09', start: '13:00', end: '17:00' }).expect(201);
    });

    it('erlaubt Vorgesetzten den Nachtrag für ihr Team, sonst niemandem', async () => {
      const res = (
        await manual(lead.cookie, {
          employeeId: emp.id,
          date: '2026-10-09',
          start: '08:00',
          end: '12:00',
        }).expect(201)
      ).body as EntrySaveResult;
      expect(res.entry.recordedByName).toBe('Lead');
      await manual(lead.cookie, {
        employeeId: other.id,
        date: '2026-10-09',
        start: '08:00',
        end: '12:00',
      }).expect(404);
      await manual(other.cookie, {
        employeeId: emp.id,
        date: '2026-10-09',
        start: '08:00',
        end: '12:00',
      }).expect(404);
    });

    it('erlaubt Arbeit über Mitternacht und markiert Sonntagsarbeit ohne zu blockieren', async () => {
      const res = (
        await manual(emp.cookie, { date: '2026-10-11', start: '20:00', end: '01:00' }).expect(201)
      ).body as EntrySaveResult;
      expect(res.entry.endsNextDay).toBe(true);
      expect(res.flags.map((f) => f.code)).toContain('SUNDAY_WORK');
    });
  });

  describe('Korrekturen (Variante B)', () => {
    async function entryOf(cookie: string): Promise<string> {
      const res = await manual(cookie, {
        date: '2026-10-09',
        start: '08:00',
        end: '16:00',
        breaks: [{ start: '12:00', end: '12:30' }],
      }).expect(201);
      return (res.body as EntrySaveResult).entry.id;
    }

    it('macht eigene Korrekturen zum Antrag, den Vorgesetzte freigeben; jede Änderung hat eine Revision', async () => {
      const id = await entryOf(emp.cookie);
      const res = (
        await post(`/api/time/entries/${id}/correct`, emp.cookie)
          .send({
            start: '07:30',
            end: '16:00',
            breaks: [{ start: '12:00', end: '12:30' }],
            reason: 'Früher angefangen',
          })
          .expect(200)
      ).body as CorrectionResult;
      expect(res.applied).toBe(false);
      expect(res.entry.startLocal).toBe('08:00');
      expect(res.entry.pendingCorrection?.kind).toBe('CORRECT');

      // Fremde Anträge sind außerhalb des Sichtbereichs (seit Phase 3 ohne Rollensperre, wegen der Vertretung).
      await post(`/api/time/corrections/${res.request?.id}/approve`, other.cookie).expect(404);
      await post(`/api/time/corrections/${res.request?.id}/approve`, lead.cookie).expect(200);
      const week = (await get(`/api/time/week?week=2026-W41`, emp.cookie).expect(200))
        .body as WeekView;
      const corrected = week.days.find((d) => d.date === '2026-10-09')?.entries[0];
      expect(corrected).toMatchObject({ startLocal: '07:30', pendingCorrection: null });

      const revisions = (await get(`/api/time/entries/${id}/revisions`, emp.cookie).expect(200))
        .body as { reason: string; before: { start: string } }[];
      expect(revisions).toHaveLength(1);
      expect(revisions[0]?.reason).toBe('Antrag freigegeben: Früher angefangen');
      expect(revisions[0]?.before.start).toBe('2026-10-09T06:00:00.000Z');
    });

    it('wendet Korrekturen von Vorgesetzten sofort an', async () => {
      const id = await entryOf(emp.cookie);
      const res = (
        await post(`/api/time/entries/${id}/correct`, lead.cookie)
          .send({
            start: '08:00',
            end: '17:00',
            breaks: [{ start: '12:00', end: '12:45' }],
            reason: 'Korrektur laut Stundenzettel',
          })
          .expect(200)
      ).body as CorrectionResult;
      expect(res).toMatchObject({ applied: true, request: null });
      expect(res.entry.endLocal).toBe('17:00');
    });

    it('verlangt eine Begründung beim Ablehnen; zurückziehen darf nur die antragstellende Person', async () => {
      const id = await entryOf(emp.cookie);
      const req = (
        await post(`/api/time/entries/${id}/void`, emp.cookie)
          .send({ reason: 'Doppelt gebucht' })
          .expect(200)
      ).body as CorrectionResult;
      await post(`/api/time/entries/${id}/void`, emp.cookie)
        .send({ reason: 'Nochmal' })
        .expect(409);
      await post(`/api/time/corrections/${req.request?.id}/reject`, lead.cookie)
        .send({ reason: '' })
        .expect(400);
      await post(`/api/time/corrections/${req.request?.id}/withdraw`, lead.cookie).expect(404);
      await post(`/api/time/corrections/${req.request?.id}/withdraw`, emp.cookie).expect(200);
      await post(`/api/time/corrections/${req.request?.id}/approve`, lead.cookie).expect(409);
    });

    it('zählt ungültige Buchungen nicht mehr, löscht sie aber nie', async () => {
      const id = await entryOf(emp.cookie);
      await post(`/api/time/entries/${id}/void`, admin.cookie)
        .send({ reason: 'Doppelt gebucht' })
        .expect(200);
      const week = (
        await get(`/api/time/week?employeeId=${emp.id}&week=2026-W41`, admin.cookie).expect(200)
      ).body as WeekView;
      const day = week.days.find((d) => d.date === '2026-10-09');
      expect(day?.workMinutes).toBe(0);
      expect(day?.entries[0]?.voided).toBe(true);
      await expect(ctx.prisma.timeEntry.delete({ where: { id } })).rejects.toThrow();
      await expect(
        ctx.prisma.timeEntryRevision.updateMany({ data: { reason: 'x' } }),
      ).rejects.toThrow();
    });
  });

  describe('Monatsabschluss', () => {
    it('sperrt eigene Änderungen nach dem Abschluss; Vorgesetzte dürfen weiter, der Admin öffnet wieder', async () => {
      await manual(emp.cookie, { date: '2026-09-30', start: '08:00', end: '12:00' }).expect(201);
      await post('/api/time/months/2026-10/close', emp.cookie).expect(400);
      await post('/api/time/months/2026-09/close', emp.cookie).expect(200);
      await post('/api/time/months/2026-09/close', emp.cookie).expect(409);
      const closed = await manual(emp.cookie, {
        date: '2026-09-29',
        start: '08:00',
        end: '12:00',
      }).expect(409);
      expect(closed.body.message).toContain('abgeschlossen');
      await manual(lead.cookie, {
        employeeId: emp.id,
        date: '2026-09-29',
        start: '08:00',
        end: '12:00',
      }).expect(201);
      await post(`/api/time/months/${emp.id}/2026-09/reopen`, admin.cookie).expect(200);
      await manual(emp.cookie, { date: '2026-09-28', start: '08:00', end: '12:00' }).expect(201);
    });
  });

  describe('Wochenansicht und Überstundenkonto', () => {
    it('setzt das Soll an Feiertagen auf 0 und rechnet den Saldo', async () => {
      ctx.clock.set('2026-12-28T08:00:00.000Z');
      emp.cookie = await sessionCookie(ctx, emp.id); // die alte Sitzung ist nach 30 Tagen abgelaufen
      for (const d of ['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24']) {
        await manual(emp.cookie, {
          date: d,
          start: '08:00',
          end: '16:30',
          breaks: [{ start: '12:00', end: '12:30' }],
        }).expect(201);
      }
      const week = (await get('/api/time/week?week=2026-W52', emp.cookie).expect(200))
        .body as WeekView;
      expect(week.days.find((d) => d.date === '2026-12-25')).toMatchObject({
        targetMinutes: 0,
        holidayName: '1. Weihnachtstag',
        missing: false,
      });
      expect(week.totals).toEqual({
        workMinutes: 4 * 480,
        targetMinutes: 4 * 480,
        balanceMinutes: 0,
      });
    });

    it('führt ein aktivierbares Überstundenkonto mit Korrekturbuchungen', async () => {
      await http(ctx)
        .put(`/api/employees/${emp.id}/overtime-account`)
        .set('Origin', ORIGIN)
        .set('Cookie', admin.cookie)
        .send({ since: '2026-10-05' })
        .expect(200);
      for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']) {
        await manual(emp.cookie, {
          date: d,
          start: '08:00',
          end: '17:30',
          breaks: [{ start: '12:00', end: '12:30' }],
        }).expect(201);
      }
      await post(`/api/employees/${emp.id}/overtime-adjustments`, admin.cookie)
        .send({ minutes: -120, effectiveOn: '2026-10-09', reason: 'Auszahlung' })
        .expect(201);
      const today = (await get('/api/time/today', emp.cookie).expect(200)).body as TodayView;
      expect(today.overtime?.balanceMinutes).toBe(5 * 60 - 120);
    });
  });

  it('zeigt Vorgesetzten die Anwesenheit ihres Teams, Mitarbeitern nicht', async () => {
    await post('/api/time/clock/in', emp.cookie).expect(200);
    const rows = (await get('/api/time/team-today', lead.cookie).expect(200)).body as {
      name: string;
      presence: string;
      since: string | null;
    }[];
    expect(rows).toEqual([
      expect.objectContaining({ name: 'Jonas', presence: 'PRESENT', since: '08:00' }),
    ]);
    await get('/api/time/team-today', emp.cookie).expect(403);
  });

  it('rechnet den Minijob-Monat gegen die Grenze', async () => {
    const mini = await createEmployee(ctx.prisma, { leadId: lead.id, type: 'MINIJOB' });
    const cookie = await sessionCookie(ctx, mini.id);
    await ctx.prisma.employee.update({
      where: { id: mini.id },
      data: { entryDate: fromLocalDate('2026-01-01') },
    });
    for (const d of ['2026-10-01', '2026-10-06', '2026-10-08']) {
      await manual(cookie, { date: d, start: '08:30', end: '12:30' }).expect(201);
    }
    const month = (await get('/api/time/month?month=2026-10', cookie).expect(200)).body as {
      minijob: { earningsCents: number; level: string };
    };
    expect(month.minijob).toMatchObject({ earningsCents: 12 * 1400, level: 'ok' });
  });

  describe('Befunde Codex-Review Phase 2', () => {
    it('speichert exakte Serverzeit und verhindert überlappende Buchungen bei schnellen Wiederholungen (1)', async () => {
      await post('/api/time/clock/in', emp.cookie).expect(200);
      ctx.clock.advance(10_000);
      await post('/api/time/clock/out', emp.cookie).expect(200);
      ctx.clock.advance(10_000);
      await post('/api/time/clock/in', emp.cookie).expect(200);
      const entries = await ctx.prisma.timeEntry.findMany({
        where: { employeeId: emp.id },
        orderBy: { startAt: 'asc' },
      });
      expect(entries[0]?.endAt?.toISOString()).toBe('2026-10-12T06:00:10.000Z');
      expect(entries[1]!.startAt > entries[0]!.endAt!).toBe(true);
      await post('/api/time/clock/out', emp.cookie).expect(409); // im selben Augenblick
    });

    it('sperrt Pause und Gehen nach dem Monatsabschluss und erlaubt offene Korrekturen nur für heute (2)', async () => {
      ctx.clock.set('2026-09-30T20:00:00.000Z'); // 30.09. 22:00
      emp.cookie = await sessionCookie(ctx, emp.id);
      await post('/api/time/clock/in', emp.cookie).expect(200);
      ctx.clock.set('2026-10-01T06:00:00.000Z');
      await ctx.prisma.monthClosing.create({
        data: { employeeId: emp.id, month: '2026-09', confirmedAt: new Date() },
      });
      await post('/api/time/clock/break-start', emp.cookie).expect(409);
      await post('/api/time/clock/out', emp.cookie).expect(409);
      const entry = await manual(lead.cookie, {
        employeeId: emp.id,
        date: '2026-09-28',
        start: '08:00',
        end: '12:00',
      }).expect(201);
      await post(
        `/api/time/entries/${(entry.body as EntrySaveResult).entry.id}/correct`,
        lead.cookie,
      )
        .send({ start: '08:00', end: null, breaks: [], reason: 'Öffnen' })
        .expect(400);
    });

    it('markiert auch alte laufende Buchungen als ungültig, ohne ein Ende zu erfinden (3)', async () => {
      await post('/api/time/clock/in', emp.cookie).expect(200);
      ctx.clock.advance(30 * 3_600_000);
      lead.cookie = await sessionCookie(ctx, lead.id);
      const entry = await ctx.prisma.timeEntry.findFirstOrThrow({ where: { employeeId: emp.id } });
      const res = (
        await post(`/api/time/entries/${entry.id}/void`, lead.cookie)
          .send({ reason: 'Vergessen auszustempeln' })
          .expect(200)
      ).body as CorrectionResult;
      expect(res.entry).toMatchObject({ voided: true, end: null });
    });

    it('rechnet nach dem Austritt kein Soll und keine fehlenden Tage (4)', async () => {
      await ctx.prisma.employee.update({
        where: { id: emp.id },
        data: { exitDate: fromLocalDate('2026-10-09') },
      });
      const week = (
        await get(`/api/time/week?employeeId=${emp.id}&week=2026-W42`, admin.cookie).expect(200)
      ).body as WeekView;
      expect(week.days[0]).toMatchObject({
        date: '2026-10-12',
        targetMinutes: null,
        balanceMinutes: null,
        missing: false,
      });
    });

    it('zählt Überstundenkorrekturen erst ab ihrem Wirksamkeitsdatum und nicht vor Kontobeginn (5)', async () => {
      await http(ctx)
        .put(`/api/employees/${emp.id}/overtime-account`)
        .set('Origin', ORIGIN)
        .set('Cookie', admin.cookie)
        .send({ since: '2026-10-12' })
        .expect(200);
      await post(`/api/employees/${emp.id}/overtime-adjustments`, admin.cookie)
        .send({ minutes: -120, effectiveOn: '2026-12-01', reason: 'Auszahlung' })
        .expect(201);
      await post(`/api/employees/${emp.id}/overtime-adjustments`, admin.cookie)
        .send({ minutes: 60, effectiveOn: '2026-10-01', reason: 'Altsaldo' })
        .expect(400);
      const overtime = (
        await get(`/api/time/overtime?employeeId=${emp.id}`, admin.cookie).expect(200)
      ).body as { balanceMinutes: number };
      expect(overtime.balanceMinutes).toBe(0);
    });

    it('bewertet Minijob-Stunden mit dem Lohn ihres Arbeitstags (7)', async () => {
      const mini = await createEmployee(ctx.prisma, { leadId: lead.id, type: 'MINIJOB' });
      await ctx.prisma.employmentTerms.create({
        data: {
          employeeId: mini.id,
          validFrom: fromLocalDate('2026-10-05'),
          type: 'MINIJOB',
          weeklyMinutes: 480,
          workDays: [2, 4],
          annualLeaveDays: 8,
          hourlyWageCents: 2000,
        },
      });
      const cookie = await sessionCookie(ctx, mini.id);
      await manual(cookie, { date: '2026-10-01', start: '08:00', end: '12:00' }).expect(201);
      await manual(cookie, { date: '2026-10-06', start: '08:00', end: '12:00' }).expect(201);
      const month = (await get('/api/time/month?month=2026-10', cookie).expect(200)).body as {
        minijob: { earningsCents: number };
      };
      expect(month.minijob.earningsCents).toBe(4 * 1400 + 4 * 2000);
    });

    it('lehnt ein Minijob-Überstundenkonto unabhängig von der Reihenfolge der Vertragsstände ab (8)', async () => {
      const person = await createEmployee(ctx.prisma, { leadId: lead.id });
      await ctx.prisma.employmentTerms.create({
        data: {
          employeeId: person.id,
          validFrom: fromLocalDate('2026-06-01'),
          type: 'MINIJOB',
          weeklyMinutes: 480,
          workDays: [2, 4],
          annualLeaveDays: 8,
          hourlyWageCents: 1400,
        },
      });
      await http(ctx)
        .put(`/api/employees/${person.id}/overtime-account`)
        .set('Origin', ORIGIN)
        .set('Cookie', admin.cookie)
        .send({ since: '2026-10-01' })
        .expect(400);
      await http(ctx)
        .put(`/api/employees/${person.id}/overtime-account`)
        .set('Origin', ORIGIN)
        .set('Cookie', admin.cookie)
        .send({ since: '2026-03-01' })
        .expect(200);
    });

    it('erkennt verkürzte Ruhezeit nach einer früher begonnenen Nachtschicht (10)', async () => {
      await manual(emp.cookie, {
        date: '2026-10-02',
        start: '23:00',
        end: '15:00',
        breaks: [{ start: '03:00', end: '04:00' }],
      }).expect(201);
      const res = (
        await manual(emp.cookie, { date: '2026-10-04', start: '01:00', end: '05:00' }).expect(201)
      ).body as EntrySaveResult;
      expect(res.flags.map((f) => f.code)).toContain('REST_PERIOD');
    });

    it('zeigt Korrekturanträge nur im erlaubten Bereich (11)', async () => {
      const entry = (
        await manual(emp.cookie, { date: '2026-10-09', start: '08:00', end: '12:00' }).expect(201)
      ).body as EntrySaveResult;
      await post(`/api/time/entries/${entry.entry.id}/void`, emp.cookie)
        .send({ reason: 'Doppelt' })
        .expect(200);
      const ids = async (cookie: string) =>
        (
          (await get('/api/time/corrections', cookie).expect(200)).body as { employeeId: string }[]
        ).map((r) => r.employeeId);
      expect(await ids(emp.cookie)).toEqual([emp.id]);
      expect(await ids(lead.cookie)).toEqual([emp.id]);
      expect(await ids(other.cookie)).toEqual([]);
      expect(await ids(admin.cookie)).toEqual([emp.id]);
    });

    it('lässt Vorgesetzte eigene Anträge nicht selbst freigeben (11)', async () => {
      const entry = (
        await manual(lead.cookie, { date: '2026-10-09', start: '08:00', end: '12:00' }).expect(201)
      ).body as EntrySaveResult;
      const req = (
        await post(`/api/time/entries/${entry.entry.id}/void`, lead.cookie)
          .send({ reason: 'Doppelt' })
          .expect(200)
      ).body as CorrectionResult;
      expect(req.applied).toBe(false);
      await post(`/api/time/corrections/${req.request?.id}/approve`, lead.cookie).expect(403);
      await post(`/api/time/corrections/${req.request?.id}/approve`, admin.cookie).expect(200);
    });

    it('entscheidet parallele Freigabe und Ablehnung genau einmal (11)', async () => {
      const entry = (
        await manual(emp.cookie, { date: '2026-10-09', start: '08:00', end: '12:00' }).expect(201)
      ).body as EntrySaveResult;
      const req = (
        await post(`/api/time/entries/${entry.entry.id}/void`, emp.cookie)
          .send({ reason: 'Doppelt' })
          .expect(200)
      ).body as CorrectionResult;
      const results = await Promise.all([
        post(`/api/time/corrections/${req.request?.id}/approve`, lead.cookie),
        post(`/api/time/corrections/${req.request?.id}/reject`, admin.cookie).send({
          reason: 'Nein',
        }),
        post(`/api/time/corrections/${req.request?.id}/withdraw`, emp.cookie),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(
        await ctx.prisma.timeEntryRevision.count({ where: { entryId: entry.entry.id } }),
      ).toBeLessThanOrEqual(1);
    });
  });
});
