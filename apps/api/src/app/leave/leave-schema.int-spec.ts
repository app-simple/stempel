import { fromLocalDate } from '../common/dates';
import { createEmployee, createTestApp, resetDb, type TestContext } from '../../testing/test-app';

/** Schutzregeln der Datenbank für Abwesenheiten (Spezifikation Phase 3, Abschnitt 4). */
describe('Abwesenheiten: Schutz in der Datenbank', () => {
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

  const request = (from: string, to: string, extra: Record<string, unknown> = {}) =>
    ctx.prisma.leaveRequest.create({
      data: {
        employeeId,
        type: 'VACATION',
        from: fromLocalDate(from),
        to: fromLocalDate(to),
        halfDays: 2,
        requestedAt: new Date(),
        requestedById: employeeId,
        ...extra,
      },
    });

  it('verhindert überlappende offene oder genehmigte Anträge derselben Person', async () => {
    await request('2026-11-02', '2026-11-06');
    await expect(request('2026-11-06', '2026-11-10')).rejects.toThrow();
    await expect(request('2026-10-26', '2026-11-02')).rejects.toThrow();
    await request('2026-11-07', '2026-11-10');
    const other = (await createEmployee(ctx.prisma, { leadId })).id;
    await request('2026-11-02', '2026-11-06', { employeeId: other, requestedById: other });
  });

  it('lässt nach Ablehnung, Rücknahme und Stornierung einen neuen Antrag im selben Zeitraum zu', async () => {
    const first = await request('2026-11-02', '2026-11-06');
    await ctx.prisma.leaveRequest.update({
      where: { id: first.id },
      data: { status: 'WITHDRAWN' },
    });
    const second = await request('2026-11-02', '2026-11-06');
    await ctx.prisma.leaveRequest.update({
      where: { id: second.id },
      data: { status: 'APPROVED', decidedAt: new Date(), decidedById: leadId },
    });
    await ctx.prisma.leaveRequest.update({
      where: { id: second.id },
      data: {
        status: 'CANCELLED',
        cancelRequestedAt: new Date(),
        cancelledAt: new Date(),
        cancelledById: leadId,
      },
    });
    await request('2026-11-02', '2026-11-06');
  });

  it('erzwingt Einverständnis zur Stornierung und verbietet Entscheidungen über eigene Anträge', async () => {
    const approved = await request('2026-11-02', '2026-11-06', {
      status: 'APPROVED',
      decidedAt: new Date(),
      decidedById: leadId,
    });
    await expect(
      ctx.prisma.leaveRequest.update({
        where: { id: approved.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: leadId },
      }),
    ).rejects.toThrow();
    await expect(
      request('2026-12-01', '2026-12-01', {
        status: 'APPROVED',
        decidedAt: new Date(),
        decidedById: employeeId,
      }),
    ).rejects.toThrow();
    const pending = await request('2026-12-02', '2026-12-02');
    await expect(
      ctx.prisma.leaveRequest.update({
        where: { id: pending.id },
        data: { status: 'APPROVED', decidedAt: new Date(), decidedById: employeeId },
      }),
    ).rejects.toThrow();
    // Der Admin darf über eigene Anträge entscheiden (Entscheidung 8).
    const admin = (await createEmployee(ctx.prisma, { role: 'ADMIN' })).id;
    await request('2026-12-01', '2026-12-01', {
      employeeId: admin,
      requestedById: admin,
      status: 'APPROVED',
      decidedAt: new Date(),
      decidedById: admin,
    });
  });

  it('nimmt von parallelen überlappenden Anträgen genau einen an', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => request('2026-12-21', '2026-12-23')),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('prüft Zeitraum, halbe Tage, Notiz und Ablehnungsgrund', async () => {
    await expect(request('2026-11-06', '2026-11-02')).rejects.toThrow();
    await expect(
      request('2026-11-02', '2026-11-02', { startHalf: true, endHalf: true }),
    ).rejects.toThrow();
    await expect(request('2026-11-02', '2026-11-02', { halfDays: 0 })).rejects.toThrow();
    await expect(request('2026-11-02', '2026-11-02', { note: 'x'.repeat(141) })).rejects.toThrow();
    const pending = await request('2026-11-02', '2026-11-02', { note: 'x'.repeat(140) });
    await expect(
      ctx.prisma.leaveRequest.update({
        where: { id: pending.id },
        data: {
          status: 'REJECTED',
          decidedAt: new Date(),
          decidedById: leadId,
          decisionReason: ' ',
        },
      }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.leaveRequest.update({ where: { id: pending.id }, data: { status: 'APPROVED' } }),
    ).rejects.toThrow();
  });

  it('schützt Kernfelder, erlaubt nur zulässige Statuswechsel und verbietet Löschen', async () => {
    const pending = await request('2026-11-02', '2026-11-06');
    await expect(
      ctx.prisma.leaveRequest.update({
        where: { id: pending.id },
        data: { to: fromLocalDate('2026-11-09') },
      }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.leaveRequest.update({
        where: { id: pending.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: leadId },
      }),
    ).rejects.toThrow();
    await expect(ctx.prisma.leaveRequest.delete({ where: { id: pending.id } })).rejects.toThrow();

    await ctx.prisma.leaveRequest.update({
      where: { id: pending.id },
      data: { status: 'APPROVED', decidedAt: new Date(), decidedById: leadId },
    });
    await expect(
      ctx.prisma.leaveRequest.update({ where: { id: pending.id }, data: { status: 'REJECTED' } }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.leaveRequest.update({
        where: { id: pending.id },
        data: { decidedById: employeeId },
      }),
    ).rejects.toThrow();
    // Stornierung erbitten und zurückweisen bleibt im Status „genehmigt“ möglich.
    await ctx.prisma.leaveRequest.update({
      where: { id: pending.id },
      data: { cancelRequestedAt: new Date() },
    });
    await ctx.prisma.leaveRequest.update({
      where: { id: pending.id },
      data: { cancelRequestedAt: null },
    });

    const rejected = await request('2026-12-01', '2026-12-01');
    await ctx.prisma.leaveRequest.update({
      where: { id: rejected.id },
      data: {
        status: 'REJECTED',
        decidedAt: new Date(),
        decidedById: leadId,
        decisionReason: 'Engpass',
      },
    });
    await expect(
      ctx.prisma.leaveRequest.update({
        where: { id: rejected.id },
        data: { decisionReason: 'anders' },
      }),
    ).rejects.toThrow();
  });

  it('hält Korrekturbuchungen unveränderlich', async () => {
    const entry = await ctx.prisma.leaveLedgerEntry.create({
      data: {
        employeeId,
        year: 2026,
        kind: 'CORRECTION',
        halfDays: 4,
        note: 'Rückbuchung nach § 9 BUrlG',
        createdById: leadId,
      },
    });
    await expect(
      ctx.prisma.leaveLedgerEntry.update({ where: { id: entry.id }, data: { halfDays: 6 } }),
    ).rejects.toThrow();
    await expect(ctx.prisma.leaveLedgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow();
    await expect(
      ctx.prisma.leaveLedgerEntry.create({
        data: {
          employeeId,
          year: 2026,
          kind: 'CORRECTION',
          halfDays: 0,
          note: 'x',
          createdById: leadId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.leaveLedgerEntry.create({
        data: {
          employeeId,
          year: 2026,
          kind: 'CORRECTION',
          halfDays: 2,
          note: ' ',
          createdById: leadId,
        },
      }),
    ).rejects.toThrow();
  });
});
