import { fromLocalDate } from '../common/dates';
import {
  createEmployee,
  createTestApp,
  http,
  resetDb,
  seedLegalParameters,
  sessionCookie,
  type TestContext,
} from '../../testing/test-app';

/** Export der Nachweise (Spezifikation Phase 4, Entscheidungen 4 und 5). */
describe('Export', () => {
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
    ctx.clock.set('2026-10-12T08:00:00.000Z');
    await seedLegalParameters(ctx.prisma);
    const person = async (seed: Parameters<typeof createEmployee>[1]): Promise<Person> => {
      const p = await createEmployee(ctx.prisma, seed);
      return { ...p, cookie: await sessionCookie(ctx, p.id) };
    };
    admin = await person({ role: 'ADMIN', name: 'Admin' });
    lead = await person({ role: 'LEAD', leadId: admin.id, name: 'Tobias Lechner' });
    emp = await person({ leadId: lead.id, name: 'Elif Aydin' });
    other = await person({ leadId: admin.id, name: 'Lena Hofbauer' });
    await ctx.prisma.timeEntry.create({
      data: {
        employeeId: emp.id,
        workDate: fromLocalDate('2026-10-05'),
        startAt: new Date('2026-10-05T06:00:00Z'),
        endAt: new Date('2026-10-05T14:30:00Z'),
        source: 'MANUAL',
        reason: 'Stempeln vergessen; Tablet leer',
        recordedAt: new Date('2026-10-05T08:04:00Z'),
        recordedById: emp.id,
      },
    });
    await ctx.prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        type: 'VACATION',
        from: fromLocalDate('2026-10-06'),
        to: fromLocalDate('2026-10-06'),
        halfDays: 2,
        status: 'APPROVED',
        requestedAt: new Date(),
        requestedById: emp.id,
        decidedAt: new Date(),
        decidedById: lead.id,
      },
    });
  });

  const get = (path: string, cookie: string) =>
    http(ctx)
      .get(path)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  it('liefert den eigenen Monat als CSV mit Nachtrag, Grund und Abwesenheit', async () => {
    const res = await get('/api/exports/time?month=2026-10&format=csv', emp.cookie).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="arbeitszeit-2026-10-elif-aydin.csv"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    const text = (res.body as Buffer).toString('utf8');
    expect(text.startsWith('﻿Datum;Tag;Kommen;Gehen')).toBe(true);
    expect(text).toContain(
      '05.10.2026;Mo;08:00;16:30;0;8:30;8:00;0:30;;Nachtrag;05.10.2026 10:04;;"Stempeln vergessen; Tablet leer"',
    );
    expect(text).toContain('06.10.2026;Di;;;;;0:00;0:00;Urlaub;');
    expect(text).not.toContain('@example.com');
    // Stand des Exports (Codex-Review Phase 4 API, Befund 15).
    expect(text).toContain('Erstellt am 12.10.2026 10:00 (Europe/Berlin)');
  });

  it('liefert ein PDF', async () => {
    const res = await get('/api/exports/time?month=2026-10&format=pdf', emp.cookie).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(1500);
  });

  it('exportiert für andere nur im eigenen Sichtbereich', async () => {
    await get(
      `/api/exports/time?month=2026-10&format=csv&employeeId=${emp.id}`,
      lead.cookie,
    ).expect(200);
    await get(
      `/api/exports/time?month=2026-10&format=csv&employeeId=${emp.id}`,
      other.cookie,
    ).expect(404);
    await get(
      `/api/exports/time?month=2026-10&format=pdf&employeeId=${other.id}`,
      lead.cookie,
    ).expect(404);
    await get(
      `/api/exports/time?month=2026-10&format=csv&employeeId=${other.id}`,
      admin.cookie,
    ).expect(200);
    await get('/api/exports/time?month=2026-10&format=xls', emp.cookie).expect(400);
    await get('/api/exports/time?month=2026-13&format=csv', emp.cookie).expect(400);
  });

  it('liefert dem Admin die Monatsübersicht aller als CSV', async () => {
    await get('/api/exports/month?month=2026-10', lead.cookie).expect(403);
    const res = await get('/api/exports/month?month=2026-10', admin.cookie).expect(200);
    const lines = (res.body as Buffer).toString('utf8').trim().split('\r\n');
    expect(lines[0]).toContain(
      'Name;Beschäftigungsart;Arbeitszeit (Std.);Soll (Std.);Saldo (Std.);Urlaub (Tage)',
    );
    expect(lines).toHaveLength(7);
    expect(lines.at(-1)).toBe('Erstellt am 12.10.2026 10:00 (Europe/Berlin)');
    expect(lines.find((l) => l.startsWith('Elif Aydin'))).toContain(';Vollzeit;8:30;');
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'export.month', actorId: admin.id },
      orderBy: { at: 'desc' },
    });
    expect(audit).not.toBeNull();
  });
});
