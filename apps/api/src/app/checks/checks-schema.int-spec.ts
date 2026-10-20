import { fromLocalDate } from '../common/dates';
import { createEmployee, createTestApp, resetDb, type TestContext } from '../../testing/test-app';

/** Schutz in der Datenbank für Phase 4: Urlaubshinweis, Löschen nur durch den Löschjob. */
describe('Prüfungen und Nachweise: Schutz in der Datenbank', () => {
  let ctx: TestContext;
  let employeeId: string;
  let adminId: string;

  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    adminId = (await createEmployee(ctx.prisma, { role: 'ADMIN' })).id;
    employeeId = (await createEmployee(ctx.prisma, { leadId: adminId })).id;
  });

  const notice = () =>
    ctx.prisma.leaveNotice.create({
      data: {
        employeeId,
        year: 2026,
        restHalfDays: 10,
        text: 'Hinweis',
        sentAt: new Date(),
        sentById: adminId,
      },
    });

  it('erlaubt am Urlaubshinweis nur die einmalige Lesebestätigung', async () => {
    const n = await notice();
    await expect(
      ctx.prisma.leaveNotice.update({ where: { id: n.id }, data: { text: 'anders' } }),
    ).rejects.toThrow();
    await ctx.prisma.leaveNotice.update({ where: { id: n.id }, data: { readAt: new Date() } });
    await expect(
      ctx.prisma.leaveNotice.update({ where: { id: n.id }, data: { readAt: new Date() } }),
    ).rejects.toThrow();
    await expect(ctx.prisma.leaveNotice.delete({ where: { id: n.id } })).rejects.toThrow();
  });

  it('lässt geschützte Daten nur mit gesetzter Löschfreigabe löschen, nie ändern', async () => {
    const n = await notice();
    const entry = await ctx.prisma.timeEntry.create({
      data: {
        employeeId,
        workDate: fromLocalDate('2023-03-01'),
        startAt: new Date('2023-03-01T07:00:00Z'),
        endAt: new Date('2023-03-01T15:00:00Z'),
        source: 'CLOCK',
        recordedAt: new Date('2023-03-01T07:00:00Z'),
        recordedById: employeeId,
      },
    });
    await ctx.prisma.auditLog.create({ data: { action: 'test' } });
    await expect(ctx.prisma.timeEntry.delete({ where: { id: entry.id } })).rejects.toThrow();
    await expect(ctx.prisma.auditLog.deleteMany({})).rejects.toThrow();

    await ctx.prisma.$transaction([
      ctx.prisma.$executeRaw`SELECT set_config('asos.purge', txid_current()::text, true)`,
      ctx.prisma.timeEntry.delete({ where: { id: entry.id } }),
      ctx.prisma.leaveNotice.delete({ where: { id: n.id } }),
      ctx.prisma.auditLog.deleteMany({ where: { action: 'test' } }),
    ]);
    expect(await ctx.prisma.timeEntry.count({ where: { id: entry.id } })).toBe(0);

    // Ein pauschaler Wert gibt nichts frei, nur die eigene Transaktions-ID (Codex-Review, Befund 7).
    await ctx.prisma.auditLog.create({ data: { action: 'pauschal' } });
    await expect(
      ctx.prisma.$transaction([
        ctx.prisma.$executeRawUnsafe("SET LOCAL asos.purge = 'on'"),
        ctx.prisma.auditLog.deleteMany({ where: { action: 'pauschal' } }),
      ]),
    ).rejects.toThrow();

    // Die Freigabe gilt nur in ihrer Transaktion und nie für Änderungen.
    await ctx.prisma.auditLog.create({ data: { action: 'test2' } });
    await expect(ctx.prisma.auditLog.deleteMany({ where: { action: 'test2' } })).rejects.toThrow();
    await expect(
      ctx.prisma.$transaction([
        ctx.prisma.$executeRaw`SELECT set_config('asos.purge', txid_current()::text, true)`,
        ctx.prisma.auditLog.updateMany({ where: { action: 'test2' }, data: { action: 'x' } }),
      ]),
    ).rejects.toThrow();
  });

  it('verlangt Aufbewahrungsfristen von mindestens zwei Jahren', async () => {
    await ctx.prisma.companySettings.upsert({ where: { id: 1 }, create: {}, update: {} });
    await expect(
      ctx.prisma.companySettings.update({ where: { id: 1 }, data: { retentionTimeYears: 1 } }),
    ).rejects.toThrow();
    await ctx.prisma.companySettings.update({ where: { id: 1 }, data: { retentionTimeYears: 2 } });
  });
});
