import type { HolidayView } from '@as/shared';
import { fromLocalDate } from '../common/dates';
import {
  createEmployee,
  createTestApp,
  http,
  ORIGIN,
  resetDb,
  sessionCookie,
  type TestContext,
} from '../../testing/test-app';

describe('Feiertage Bayern und Einstellungen (Entscheidung 1)', () => {
  let ctx: TestContext;
  let adminCookie: string;
  let employeeCookie: string;

  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.clock.set('2026-10-12T08:00:00.000Z');
    const admin = await createEmployee(ctx.prisma, { role: 'ADMIN' });
    const employee = await createEmployee(ctx.prisma, { leadId: admin.id });
    adminCookie = await sessionCookie(ctx, admin.id);
    employeeCookie = await sessionCookie(ctx, employee.id);
  });

  const get = (year: number, cookie: string) =>
    http(ctx).get(`/api/holidays?year=${year}`).set('Cookie', cookie);
  const send = (method: 'post' | 'patch' | 'delete', path: string) =>
    http(ctx)[method](path).set('Origin', ORIGIN).set('Cookie', adminCookie);

  it('erzeugt die Feiertage eines Jahres einmalig, Mariä Himmelfahrt standardmäßig an', async () => {
    const res = await get(2026, employeeCookie).expect(200);
    const list = res.body as HolidayView[];
    expect(list).toHaveLength(13);
    expect(list.find((h) => h.date === '2026-08-15')?.name).toBe('Mariä Himmelfahrt');
    expect(list.find((h) => h.date === '2026-06-04')?.name).toBe('Fronleichnam');
    expect(list.every((h) => !h.editable)).toBe(true);
    await get(2026, employeeCookie).expect(200);
    expect(await ctx.prisma.holiday.count()).toBe(13);
  });

  it('schaltet Mariä Himmelfahrt ab dem laufenden Jahr ab, vergangene Jahre bleiben', async () => {
    await get(2025, adminCookie).expect(200);
    await get(2026, adminCookie).expect(200);
    await send('patch', '/api/settings/company')
      .send({ assumptionDayIsHoliday: false })
      .expect(200);
    expect(
      (await get(2026, employeeCookie)).body.some((h: HolidayView) => h.date === '2026-08-15'),
    ).toBe(false);
    expect(
      (await get(2025, employeeCookie)).body.some((h: HolidayView) => h.date === '2025-08-15'),
    ).toBe(true);
    const admin2027 = (await get(2027, adminCookie)).body as HolidayView[];
    expect(admin2027.find((h) => h.date === '2027-08-15')).toMatchObject({
      active: false,
      editable: true,
    });
  });

  it('lässt den Admin eigene Feiertage pflegen und gesetzliche nur abschalten', async () => {
    // Das AuditLog wird nie geleert; nur Einträge ab hier zählen.
    const marker = (await ctx.prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? 0n;
    const created = await send('post', '/api/holidays')
      .send({ date: '2026-12-24', name: 'Heiligabend' })
      .expect(201);
    await send('post', '/api/holidays')
      .send({ date: '2026-12-24', name: 'Heiligabend' })
      .expect(409);
    await send('post', '/api/holidays')
      .send({ date: '2025-12-24', name: 'Heiligabend' })
      .expect(409);
    await send('patch', `/api/holidays/${created.body.id}`)
      .send({ name: 'Heiligabend (betrieblich)' })
      .expect(200);

    const statutory = await ctx.prisma.holiday.findFirstOrThrow({
      where: { date: fromLocalDate('2026-11-01') },
    });
    await send('delete', `/api/holidays/${statutory.id}`).expect(409);
    await send('patch', `/api/holidays/${statutory.id}`).send({ active: false }).expect(200);
    expect(
      (await get(2026, employeeCookie)).body.some((h: HolidayView) => h.date === '2026-11-01'),
    ).toBe(false);
    await send('delete', `/api/holidays/${created.body.id}`).expect(204);

    const actions = (
      await ctx.prisma.auditLog.findMany({
        where: { action: { startsWith: 'holiday.' }, id: { gt: marker } },
        orderBy: { id: 'asc' },
      })
    ).map((a) => a.action);
    expect(actions).toEqual([
      'holiday.create',
      'holiday.update',
      'holiday.update',
      'holiday.delete',
    ]);
  });

  it('ändert vergangene Jahre nicht und prüft das Jahr', async () => {
    await get(2025, adminCookie).expect(200);
    const past = await ctx.prisma.holiday.findFirstOrThrow({
      where: { date: fromLocalDate('2025-11-01') },
    });
    await send('patch', `/api/holidays/${past.id}`).send({ active: false }).expect(409);
    await get(1999, adminCookie).expect(400);
    await http(ctx).get('/api/holidays?year=abc').set('Cookie', adminCookie).expect(400);
  });

  it('protokolliert ohne Freitext und lässt die Einstellung beim parallelen Erzeugen nicht ins Leere laufen', async () => {
    const created = await send('post', '/api/holidays')
      .send({ date: '2026-12-31', name: 'Silvester Erika Musterfrau' })
      .expect(201);
    const entry = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'holiday.create', entityId: created.body.id },
    });
    expect(entry.details).toEqual({ date: '2026-12-31' });

    await Promise.all([
      get(2030, adminCookie),
      send('patch', '/api/settings/company').send({ assumptionDayIsHoliday: false }),
    ]);
    const assumption = await ctx.prisma.holiday.findFirstOrThrow({
      where: { date: fromLocalDate('2030-08-15') },
    });
    expect(assumption.active).toBe(false);
  });
});
