import { fromLocalDate } from '../common/dates';
import { createEmployee, createTestApp, resetDb, type TestContext } from '../../testing/test-app';

/** Schutzregeln der Datenbank für Krankmeldungen (Spezifikation Phase 6, Abschnitt 3). */
describe('Krankmeldungen: Schutz in der Datenbank', () => {
  let ctx: TestContext;
  let employeeId: string;
  let leadId: string;

  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    leadId = (await createEmployee(ctx.prisma, { role: 'LEAD' })).id;
    employeeId = (await createEmployee(ctx.prisma, { leadId })).id;
  });

  const sick = (from: string, to: string, extra: Record<string, unknown> = {}) =>
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

  it('verhindert überschneidende Krankmeldungen derselben Person, auch bei Kind krank', async () => {
    await sick('2026-11-02', '2026-11-04');
    await expect(sick('2026-11-04', '2026-11-06')).rejects.toThrow();
    await expect(sick('2026-11-03', '2026-11-03', { kind: 'CHILD_SICK' })).rejects.toThrow();
    await sick('2026-11-05', '2026-11-06');
    const other = (await createEmployee(ctx.prisma, { leadId })).id;
    await sick('2026-11-02', '2026-11-04', { employeeId: other, reportedById: other });
  });

  it('prüft Zeitraum und Uhrzeit des Heimgehens', async () => {
    await expect(sick('2026-11-04', '2026-11-03')).rejects.toThrow();
    await expect(sick('2026-11-02', '2026-11-02', { sinceMinute: 1440 })).rejects.toThrow();
    await expect(sick('2026-11-02', '2026-11-02', { sinceMinute: -1 })).rejects.toThrow();
    await sick('2026-11-02', '2026-11-02', { sinceMinute: 1439 });
  });

  it('erlaubt Krankheit im genehmigten Urlaub', async () => {
    await ctx.prisma.leaveRequest.create({
      data: {
        employeeId,
        type: 'VACATION',
        from: fromLocalDate('2026-11-02'),
        to: fromLocalDate('2026-11-06'),
        halfDays: 10,
        status: 'APPROVED',
        requestedAt: new Date(),
        requestedById: employeeId,
        decidedAt: new Date(),
        decidedById: leadId,
      },
    });
    await sick('2026-11-03', '2026-11-04');
  });

  it('speichert Rückbuchungen nach § 9 BUrlG als unveränderliche Kontobuchung', async () => {
    const leave = await sick('2026-11-03', '2026-11-04');
    const entry = await ctx.prisma.leaveLedgerEntry.create({
      data: {
        employeeId,
        year: 2026,
        kind: 'SICK_CREDIT',
        halfDays: 4,
        sickLeaveId: leave.id,
        note: 'Rückbuchung nach § 9 BUrlG',
        createdById: leadId,
      },
    });
    await expect(
      ctx.prisma.leaveLedgerEntry.update({ where: { id: entry.id }, data: { halfDays: 2 } }),
    ).rejects.toThrow();
  });

  it('verlangt die AU ab dem 1. Tag nur, wenn eingestellt', async () => {
    const employee = await ctx.prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    expect(employee.certificateFromDay1).toBe(false);
  });
});
