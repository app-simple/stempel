import { createHash } from 'node:crypto';
import type {
  LateEntriesView,
  PushDeviceView,
  ReminderSettingsView,
  ReminderTodayView,
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
import { testPushKeys } from '../../testing/fakes';
import { RemindersService } from './reminders.service';

/**
 * Erinnerungen und Auswertung der Nachträge (Spezifikation Phase 5). Montag, 12.10.2026; Berlin = UTC+2.
 * Ohne gelernten Beginn gilt die Standardzeit 08:00, die Erinnerung ist ab 08:15 (06:15 UTC) fällig.
 */
describe('Erinnerungen', () => {
  let ctx: TestContext;
  type Person = { id: string; email: string; cookie: string };
  let admin: Person;
  let lead: Person;
  let emp: Person;
  let other: Person;
  let reminders: RemindersService;

  beforeAll(async () => {
    ctx = await createTestApp();
    reminders = ctx.app.get(RemindersService);
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.clock.set('2026-10-12T05:00:00.000Z');
    ctx.mail.sent.length = 0;
    ctx.push.sent.length = 0;
    ctx.push.results.clear();
    await seedLegalParameters(ctx.prisma);
    const person = async (seed: Parameters<typeof createEmployee>[1]): Promise<Person> => {
      const p = await createEmployee(ctx.prisma, seed);
      return { ...p, cookie: await sessionCookie(ctx, p.id) };
    };
    admin = await person({ role: 'ADMIN', name: 'Admin' });
    lead = await person({ role: 'LEAD', leadId: admin.id, name: 'Tobias Lechner' });
    emp = await person({ leadId: lead.id, name: 'Elif Aydin' });
    other = await person({ leadId: admin.id, name: 'Lena Hofbauer' });
    // Nur Elif wird betrachtet: alle anderen sind heute schon da.
    for (const p of [admin, lead, other])
      await entry(p.id, '2026-10-12', '04:30', '04:45', 'CLOCK');
  });

  const post = (path: string, cookie: string) =>
    http(ctx).post(path).set('Origin', ORIGIN).set('Cookie', cookie);
  const get = (path: string, cookie: string) => http(ctx).get(path).set('Cookie', cookie);
  function entry(
    employeeId: string,
    date: string,
    startUtc: string,
    endUtc: string | null,
    source: 'CLOCK' | 'MANUAL',
    recordedAt?: Date,
  ) {
    return ctx.prisma.timeEntry.create({
      data: {
        employeeId,
        workDate: fromLocalDate(date),
        startAt: new Date(`${date}T${startUtc}:00Z`),
        endAt: endUtc ? new Date(`${date}T${endUtc}:00Z`) : null,
        source,
        ...(source === 'MANUAL' ? { reason: 'Vergessen' } : {}),
        recordedAt: recordedAt ?? new Date(`${date}T${startUtc}:00Z`),
        recordedById: employeeId,
      },
    });
  }
  const device = (endpoint = 'https://fcm.googleapis.com/fcm/send/elif') =>
    ctx.prisma.pushSubscription.create({
      data: { employeeId: emp.id, endpoint, p256dh: 'k', auth: 'a', deviceName: 'Laptop' },
    });
  const logs = () =>
    ctx.prisma.reminderLog.findMany({
      where: { employeeId: emp.id },
      orderBy: [{ kind: 'asc' }, { stage: 'asc' }],
    });

  describe('Erinnerung ans Einstempeln', () => {
    it('erinnert ab Beginn + 15 Minuten, ein zweites Mal nach 60 Minuten, dann nicht mehr', async () => {
      await device();
      ctx.clock.set('2026-10-12T06:14:00.000Z');
      expect(await reminders.runOnce()).toBe(0);
      ctx.clock.set('2026-10-12T06:15:00.000Z');
      expect(await reminders.runOnce()).toBe(1);
      expect(await reminders.runOnce()).toBe(0);
      expect(ctx.push.sent).toHaveLength(1);
      expect(ctx.push.sent[0]?.payload).toEqual({
        title: 'Zeit & Urlaub',
        body: 'Du hast heute noch nicht gestempelt',
        url: '/',
        tag: 'CLOCK_IN',
        mutable: true,
      });
      ctx.clock.set('2026-10-12T07:14:00.000Z');
      expect(await reminders.runOnce()).toBe(0);
      ctx.clock.set('2026-10-12T07:15:00.000Z');
      expect(await reminders.runOnce()).toBe(1);
      ctx.clock.set('2026-10-12T12:00:00.000Z');
      expect(await reminders.runOnce()).toBe(0);
      expect((await logs()).map((l) => [l.kind, l.stage, l.channel])).toEqual([
        ['CLOCK_IN', 1, 'PUSH'],
        ['CLOCK_IN', 2, 'PUSH'],
      ]);
      expect(ctx.mail.sent).toHaveLength(0);
    });

    it('legt die Betriebseinstellungen bei parallelen Zugriffen ohne Konflikt an', async () => {
      await ctx.prisma.companySettings.deleteMany();
      const results = await Promise.allSettled([
        ...Array.from({ length: 6 }, () => reminders.runOnce()),
        ...Array.from({ length: 6 }, () =>
          http(ctx).get('/api/settings/reminders').set('Cookie', admin.cookie),
        ),
        ...Array.from({ length: 6 }, () =>
          http(ctx).get('/api/settings/retention').set('Cookie', admin.cookie),
        ),
        ...Array.from({ length: 6 }, () =>
          http(ctx).get('/api/settings/company').set('Cookie', admin.cookie),
        ),
      ]);
      expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
      expect(
        results
          .slice(6)
          .map((r) => (r as PromiseFulfilledResult<{ status: number; body: unknown }>).value)
          .filter((v) => v.status !== 200)
          .map((v) => JSON.stringify(v)),
      ).toEqual([]);
      expect(await ctx.prisma.companySettings.count()).toBe(1);
    });

    it('sendet bei parallelen Läufen nur einmal', async () => {
      ctx.clock.set('2026-10-12T06:20:00.000Z');
      const results = await Promise.all([
        reminders.runOnce(),
        reminders.runOnce(),
        reminders.runOnce(),
      ]);
      expect(results.reduce((a, b) => a + b, 0)).toBe(1);
      await ctx.mail.flush();
      expect(ctx.mail.sent.filter((m) => m.to === emp.email)).toHaveLength(1);
    });

    it('nutzt ohne Gerät die E-Mail, abschaltbar im Profil', async () => {
      ctx.clock.set('2026-10-12T06:20:00.000Z');
      await reminders.runOnce();
      expect(ctx.mail.sent.find((m) => m.to === emp.email)?.text).toContain(
        'Du hast heute noch nicht gestempelt.',
      );
      await http(ctx)
        .patch('/api/me/reminder-settings')
        .set('Origin', ORIGIN)
        .set('Cookie', emp.cookie)
        .send({ emailFallback: false })
        .expect(200);
      ctx.mail.sent.length = 0;
      ctx.clock.set('2026-10-12T07:30:00.000Z');
      expect(await reminders.runOnce()).toBe(1);
      expect(ctx.mail.sent).toHaveLength(0);
      expect((await logs()).find((l) => l.stage === 2)).toMatchObject({
        channel: null,
        sentAt: null,
      });
    });

    it('entfernt abgelaufene Geräte (410) und fällt auf E-Mail zurück', async () => {
      await device('https://fcm.googleapis.com/fcm/send/alt');
      ctx.push.results.set('https://fcm.googleapis.com/fcm/send/alt', 'gone');
      ctx.clock.set('2026-10-12T06:20:00.000Z');
      await reminders.runOnce();
      expect(await ctx.prisma.pushSubscription.count({ where: { employeeId: emp.id } })).toBe(0);
      expect((await logs())[0]?.channel).toBe('EMAIL');
    });

    it.each([
      ['an einem vertragsfreien Tag (Samstag)', '2026-10-17T07:00:00.000Z', async () => undefined],
      ['an einem Feiertag', '2026-12-25T08:00:00.000Z', async () => undefined],
      [
        'bei genehmigtem Urlaub',
        '2026-10-12T07:00:00.000Z',
        async () => {
          await approvedLeave('2026-10-12', false);
        },
      ],
      [
        'bei halbem Urlaubstag (Entscheidung 6)',
        '2026-10-12T07:00:00.000Z',
        async () => {
          await approvedLeave('2026-10-12', true);
        },
      ],
      [
        'wenn schon gestempelt ist',
        '2026-10-12T07:00:00.000Z',
        async () => {
          await entry(emp.id, '2026-10-12', '05:50', null, 'CLOCK');
        },
      ],
      [
        'wenn heute stummgeschaltet ist',
        '2026-10-12T07:00:00.000Z',
        async () => {
          await post('/api/reminders/mute', emp.cookie).expect(204);
        },
      ],
    ])('erinnert nicht %s', async (_label, at, prepare) => {
      await prepare();
      ctx.clock.set(at);
      await reminders.runOnce();
      expect((await logs()).filter((l) => l.kind === 'CLOCK_IN' && l.stage > 0)).toEqual([]);
    });

    it('lernt den Beginn aus echten Stempelzeiten, Nachträge zählen nicht', async () => {
      for (const date of ['2026-09-21', '2026-09-28', '2026-10-05'])
        await entry(emp.id, date, '07:00', '15:00', 'CLOCK'); // 09:00 Berliner Zeit
      for (const date of ['2026-09-14', '2026-09-07', '2026-08-31'])
        await entry(emp.id, date, '04:00', '12:00', 'MANUAL'); // 06:00, nur Nachträge
      ctx.clock.set('2026-10-12T06:20:00.000Z');
      const banner = (await get('/api/reminders/today', emp.cookie).expect(200))
        .body as ReminderTodayView;
      expect(banner.clockIn).toEqual({ due: false, start: '09:00', learned: true, muted: false });
      expect(await reminders.runOnce()).toBe(0);
      ctx.clock.set('2026-10-12T07:15:00.000Z');
      expect(await reminders.runOnce()).toBe(1);
      const due = (await get('/api/reminders/today', emp.cookie).expect(200))
        .body as ReminderTodayView;
      expect(due.clockIn?.due).toBe(true);
      await post('/api/reminders/mute', emp.cookie).expect(204);
      const muted = (await get('/api/reminders/today', emp.cookie).expect(200))
        .body as ReminderTodayView;
      expect(muted.clockIn).toMatchObject({ due: false, muted: true });
    });

    it('nutzt die vom Admin geänderte Standardzeit', async () => {
      const settings: ReminderSettingsView = {
        defaultStart: '09:30',
        lateFlagMinCount: 3,
        lateFlagMinPercent: 20,
        lateFlagWeeks: 6,
      };
      await http(ctx)
        .put('/api/settings/reminders')
        .set('Origin', ORIGIN)
        .set('Cookie', admin.cookie)
        .send(settings)
        .expect(200);
      await http(ctx)
        .put('/api/settings/reminders')
        .set('Origin', ORIGIN)
        .set('Cookie', admin.cookie)
        .send({ ...settings, defaultStart: '25:00' })
        .expect(400);
      ctx.clock.set('2026-10-12T07:40:00.000Z');
      expect(await reminders.runOnce()).toBe(0);
      ctx.clock.set('2026-10-12T07:45:00.000Z');
      expect(await reminders.runOnce()).toBe(1);
    });
  });

  async function approvedLeave(date: string, half: boolean) {
    await ctx.prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        type: 'VACATION',
        from: fromLocalDate(date),
        to: fromLocalDate(date),
        startHalf: half,
        halfDays: half ? 1 : 2,
        status: 'APPROVED',
        requestedAt: new Date(),
        requestedById: emp.id,
        decidedAt: new Date(),
        decidedById: lead.id,
      },
    });
  }

  it('erinnert an vergessenes Ausstempeln nach über 10 Stunden', async () => {
    await device();
    await entry(emp.id, '2026-10-12', '05:00', null, 'CLOCK');
    ctx.clock.set('2026-10-12T15:00:00.000Z');
    expect(await reminders.runOnce()).toBe(0);
    ctx.clock.set('2026-10-12T15:01:00.000Z');
    expect(await reminders.runOnce()).toBe(1);
    expect(ctx.push.sent.at(-1)?.payload.body).toBe(
      'Du bist seit über 10 Stunden eingestempelt. Ausstempeln vergessen?',
    );
    const banner = (await get('/api/reminders/today', emp.cookie).expect(200))
      .body as ReminderTodayView;
    expect(banner).toMatchObject({ clockIn: null, clockOutDue: true });
  });

  it('erinnert Minijobber am 5. bis 7. Tag an fehlende Aufzeichnungen (§ 17 MiLoG)', async () => {
    const mini = await createEmployee(ctx.prisma, {
      leadId: lead.id,
      type: 'MINIJOB',
      name: 'Anna Kroiß',
    });
    // Di 06.10. ohne Buchung, Do 08.10. mit Buchung; heute So 11.10. = Tag 5 nach dem 06.10.
    await entry(mini.id, '2026-10-08', '06:00', '10:00', 'CLOCK');
    ctx.clock.set('2026-10-11T08:00:00.000Z');
    await reminders.runOnce();
    const sent = await ctx.prisma.reminderLog.findMany({ where: { employeeId: mini.id } });
    // Protokolliert wird der Versandtag (eine gebündelte Erinnerung je Tag).
    expect(sent.map((l) => [l.kind, l.date.toISOString().slice(0, 10), l.stage])).toEqual([
      ['MINIJOB_RECORDING', '2026-10-11', 1],
    ]);
    expect(ctx.mail.sent.find((m) => m.to === mini.email)?.text).toContain('vom 06.10.2026');
    ctx.clock.set('2026-10-14T08:00:00.000Z'); // Tag 8 für den 06.10.: keine Erinnerung mehr
    await reminders.runOnce();
    expect(
      await ctx.prisma.reminderLog.count({
        where: { employeeId: mini.id, date: fromLocalDate('2026-10-14') },
      }),
    ).toBe(0);
  });

  describe('Geräte und Auswertung', () => {
    it('meldet Geräte nur für die eigene Person an und ab und sendet einen Test', async () => {
      const keys = testPushKeys();
      const list = (
        await post('/api/me/push-subscriptions', emp.cookie)
          .send({
            endpoint: 'https://fcm.googleapis.com/fcm/send/neu',
            keys,
            deviceName: 'Handy',
          })
          .expect(201)
      ).body as PushDeviceView[];
      expect(list.map((d) => d.deviceName)).toEqual(['Handy']);
      // Nur der Hash, nie der Endpunkt selbst: der Browser erkennt daran „dieses Gerät“.
      expect(list[0]?.endpointHash).toBe(
        createHash('sha256').update('https://fcm.googleapis.com/fcm/send/neu').digest('hex'),
      );
      expect(JSON.stringify(list)).not.toContain('fcm.googleapis.com');
      // Nur bekannte Push-Dienste: keine Anfragen an beliebige oder interne Adressen (SSRF).
      for (const endpoint of [
        'http://fcm.googleapis.com/fcm/send/x',
        'https://intern.example.com/push',
        'https://169.254.169.254/latest',
        'https://fcm.googleapis.com:8443/fcm/send/x',
        'https://fcm.googleapis.com.evil.example/x',
      ])
        await post('/api/me/push-subscriptions', emp.cookie)
          .send({ endpoint, keys: testPushKeys(), deviceName: 'x' })
          .expect(400);
      const test = (await post('/api/me/push-subscriptions/test', emp.cookie).expect(200)).body;
      expect(test).toEqual({ delivered: 1 });
      expect((await get('/api/me/push-subscriptions', lead.cookie).expect(200)).body).toEqual([]);
      await http(ctx)
        .delete(`/api/me/push-subscriptions/${list[0]?.id}`)
        .set('Origin', ORIGIN)
        .set('Cookie', lead.cookie)
        .expect(404);
      await http(ctx)
        .delete(`/api/me/push-subscriptions/${list[0]?.id}`)
        .set('Origin', ORIGIN)
        .set('Cookie', emp.cookie)
        .expect(204);
    });

    it('wertet Nachträge je Person aus: eigene Quote, Team für Vorgesetzte', async () => {
      // 10 Buchungen von Elif, 3 davon Nachträge am selben Tag (je 2 Std. später erfasst).
      const days = [
        '2026-09-28',
        '2026-09-29',
        '2026-09-30',
        '2026-10-01',
        '2026-10-02',
        '2026-10-05',
        '2026-10-06',
        '2026-10-07',
        '2026-10-08',
        '2026-10-09',
      ];
      for (const [i, date] of days.entries())
        await entry(
          emp.id,
          date,
          '06:00',
          '14:00',
          i < 3 ? 'MANUAL' : 'CLOCK',
          i < 3 ? new Date(`${date}T08:00:00Z`) : undefined,
        );
      await entry(
        other.id,
        '2026-10-05',
        '06:00',
        '14:00',
        'MANUAL',
        new Date('2026-10-06T08:00:00Z'),
      );
      const own = (await get('/api/time/late-entries', emp.cookie).expect(200))
        .body as LateEntriesView;
      expect(own.rows).toEqual([
        {
          employeeId: emp.id,
          employeeName: 'Elif Aydin',
          entries: 10,
          late: 3,
          percent: 30,
          averageDelayMinutes: 120,
          flagged: true,
        },
      ]);
      expect(own.thresholds).toEqual({ minCount: 3, minPercent: 20, weeks: 6 });
      const team = (await get('/api/checks/late-entries', lead.cookie).expect(200))
        .body as LateEntriesView;
      expect(team.rows.map((r) => r.employeeName).sort()).toEqual(['Elif Aydin', 'Tobias Lechner']);
      await get('/api/checks/late-entries', emp.cookie).expect(403);
    });
  });

  describe('Befunde Codex-Review Phase 5 API', () => {
    const subscribe = (cookie: string, endpoint: string, keys = testPushKeys()) =>
      post('/api/me/push-subscriptions', cookie).send({ endpoint, keys, deviceName: 'Gerät' });

    it('übernimmt fremde Anmeldungen nur mit denselben Schlüsseln (2)', async () => {
      const keys = testPushKeys();
      await subscribe(emp.cookie, 'https://fcm.googleapis.com/fcm/send/geteilt', keys).expect(201);
      await subscribe(lead.cookie, 'https://fcm.googleapis.com/fcm/send/geteilt').expect(409);
      const row = await ctx.prisma.pushSubscription.findUniqueOrThrow({
        where: { endpoint: 'https://fcm.googleapis.com/fcm/send/geteilt' },
      });
      expect(row.employeeId).toBe(emp.id);
      // Gleichzeitige Anmeldung desselben Endpunkts durch zwei Personen mit verschiedenen Schlüsseln:
      // genau eine gewinnt, die andere erhält 409 (Sicherheits-Review im Hintergrund).
      const race = await Promise.all([
        subscribe(other.cookie, 'https://fcm.googleapis.com/fcm/send/wettlauf'),
        subscribe(admin.cookie, 'https://fcm.googleapis.com/fcm/send/wettlauf'),
      ]);
      expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
      // Eigene Neuanmeldung mit neuen Schlüsseln übernimmt diese.
      const fresh = testPushKeys();
      await subscribe(emp.cookie, 'https://fcm.googleapis.com/fcm/send/geteilt', fresh).expect(201);
      expect(
        (
          await ctx.prisma.pushSubscription.findUniqueOrThrow({
            where: { endpoint: 'https://fcm.googleapis.com/fcm/send/geteilt' },
          })
        ).p256dh,
      ).toBe(fresh.p256dh);
      // Derselbe Browser (gleiche Schlüssel), andere Person angemeldet: Übernahme erlaubt.
      const keysNow = fresh;
      await subscribe(lead.cookie, 'https://fcm.googleapis.com/fcm/send/geteilt', keysNow).expect(
        201,
      );
    });

    it('lernt nicht aus korrigierten Stempelzeiten (3)', async () => {
      for (const date of ['2026-09-21', '2026-09-28', '2026-10-05']) {
        const e = await entry(emp.id, date, '07:00', '15:00', 'CLOCK');
        if (date !== '2026-10-05') continue;
        await ctx.prisma.timeEntryRevision.create({
          data: {
            entryId: e.id,
            changedById: lead.id,
            reason: 'Korrektur',
            before: {},
            after: {},
          },
        });
      }
      const banner = (await get('/api/reminders/today', emp.cookie).expect(200))
        .body as ReminderTodayView;
      expect(banner.clockIn).toMatchObject({ learned: false, start: '08:00' });
    });

    it('bündelt Minijob-Erinnerungen auf eine je Tag, nicht an Feiertagen (4, 5)', async () => {
      // Minijob Di und Do. Di 06.10. und Do 08.10. ohne Buchung; Di 13.10. = Tag 7 und Tag 5.
      const mini = await createEmployee(ctx.prisma, { leadId: lead.id, type: 'MINIJOB' });
      ctx.clock.set('2026-10-13T08:00:00.000Z');
      expect(await reminders.runOnce()).toBeGreaterThanOrEqual(1);
      await reminders.runOnce();
      const sent = await ctx.prisma.reminderLog.findMany({
        where: { employeeId: mini.id, kind: 'MINIJOB_RECORDING' },
      });
      expect(sent).toHaveLength(1);
      const minijobMails = ctx.mail.sent.filter(
        (m) => m.to === mini.email && m.text.includes('Arbeitszeit vom'),
      );
      expect(minijobMails).toHaveLength(1);
      expect(minijobMails[0]?.text).toContain('vom 06.10.2026, 08.10.2026');
      // Feiertag am Versandtag (Heilige Drei Könige, 06.01.2027): Do 31.12. wäre Tag 6.
      ctx.clock.set('2027-01-06T08:00:00.000Z');
      await reminders.runOnce();
      expect(
        await ctx.prisma.reminderLog.count({
          where: {
            employeeId: mini.id,
            kind: 'MINIJOB_RECORDING',
            date: fromLocalDate('2027-01-06'),
          },
        }),
      ).toBe(0);
      // Am Folgetag (Do 07.01., Tag 7) wieder.
      ctx.clock.set('2027-01-07T08:00:00.000Z');
      await reminders.runOnce();
      expect(
        await ctx.prisma.reminderLog.count({
          where: {
            employeeId: mini.id,
            kind: 'MINIJOB_RECORDING',
            date: fromLocalDate('2027-01-07'),
          },
        }),
      ).toBe(1);
    });

    it('sendet bei vorübergehendem Push-Fehler keine zusätzliche E-Mail (9)', async () => {
      await device('https://fcm.googleapis.com/fcm/send/hakt');
      ctx.push.results.set('https://fcm.googleapis.com/fcm/send/hakt', 'error');
      ctx.clock.set('2026-10-12T06:20:00.000Z');
      expect(await reminders.runOnce()).toBe(1);
      expect(ctx.mail.sent.filter((m) => m.to === emp.email)).toHaveLength(0);
      expect((await logs())[0]).toMatchObject({ channel: null });
      expect(await ctx.prisma.pushSubscription.count({ where: { employeeId: emp.id } })).toBe(1);
    });

    it('begrenzt Geräte je Person und Testnachrichten (7)', async () => {
      for (let i = 0; i < 10; i++)
        await subscribe(emp.cookie, `https://fcm.googleapis.com/fcm/send/g${i}`).expect(201);
      const res = await subscribe(emp.cookie, 'https://fcm.googleapis.com/fcm/send/g10').expect(
        409,
      );
      expect(res.body.message).toContain('höchstens 10 Geräte');
      for (let i = 0; i < 5; i++)
        await post('/api/me/push-subscriptions/test', emp.cookie).expect(200);
      await post('/api/me/push-subscriptions/test', emp.cookie).expect(429);
    });

    it('lehnt ungültige Schlüssel kontrolliert ab (10)', async () => {
      const endpoint = 'https://fcm.googleapis.com/fcm/send/x';
      for (const keys of [
        undefined,
        [],
        { p256dh: 'k', auth: 'a' },
        { ...testPushKeys(), auth: 'kurz' },
      ])
        await post('/api/me/push-subscriptions', emp.cookie)
          .send({ endpoint, keys, deviceName: 'x' })
          .expect(400);
    });
  });
});
