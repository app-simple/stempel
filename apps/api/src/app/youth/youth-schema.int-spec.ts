import { fromLocalDate } from '../common/dates';
import { createEmployee, createTestApp, resetDb, type TestContext } from '../../testing/test-app';

/** Schutzregeln der Datenbank für den Jugendarbeitsschutz (Spezifikation Phase 7, Abschnitt 3). */
describe('Jugendarbeitsschutz: Schutz in der Datenbank', () => {
  let ctx: TestContext;
  let employeeId: string;

  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    employeeId = (await createEmployee(ctx.prisma)).id; // Eintritt 01.01.2026
  });

  const setBirth = (birthDate: string) =>
    ctx.prisma.employee.update({
      where: { id: employeeId },
      data: { birthDate: fromLocalDate(birthDate) },
    });

  it('lässt keine Personen zu, die beim Eintritt unter 15 sind (§ 5 Abs. 1 JArbSchG)', async () => {
    await expect(setBirth('2011-01-02')).rejects.toThrow();
    await setBirth('2011-01-01');
    const row = await ctx.prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    expect(row.birthDate?.toISOString().slice(0, 10)).toBe('2011-01-01');
  });

  it('speichert das Ende der Vollzeitschulpflicht', async () => {
    await ctx.prisma.employee.update({
      where: { id: employeeId },
      data: { fullTimeSchoolUntil: fromLocalDate('2027-07-31') },
    });
    const row = await ctx.prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    expect(row.fullTimeSchoolUntil?.toISOString().slice(0, 10)).toBe('2027-07-31');
  });

  it('prüft den Zeitraum der Schulferien', async () => {
    const holiday = (from: string, to: string) =>
      ctx.prisma.schoolHoliday.create({
        data: { name: 'Herbstferien', from: fromLocalDate(from), to: fromLocalDate(to) },
      });
    await expect(holiday('2026-11-06', '2026-11-02')).rejects.toThrow();
    const ok = await holiday('2026-11-02', '2026-11-06');
    expect(ok.active).toBe(true);
  });
});

describe('Jugendarbeitsschutz: Anonymisierung', () => {
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());

  it('löscht Geburtsdatum und Schulpflichtdatum mit der Anonymisierung', async () => {
    await resetDb(ctx.prisma);
    ctx.clock.set('2026-10-16T08:00:00.000Z');
    const leaver = await ctx.prisma.employee.create({
      data: {
        name: 'Früher jung',
        loginEmail: 'jung@example.com',
        role: 'EMPLOYEE',
        entryDate: fromLocalDate('2019-01-01'),
        exitDate: fromLocalDate('2020-12-31'),
        birthDate: fromLocalDate('2003-05-05'),
        fullTimeSchoolUntil: fromLocalDate('2019-07-31'),
      },
    });
    await ctx.prisma.companySettings.upsert({
      where: { id: 1 },
      create: { retentionEnabled: true },
      update: { retentionEnabled: true },
    });
    const { RetentionService } = await import('../checks/retention.service');
    await ctx.app.get(RetentionService).runOnce();
    const row = await ctx.prisma.employee.findUniqueOrThrow({ where: { id: leaver.id } });
    expect(row).toMatchObject({ birthDate: null, fullTimeSchoolUntil: null });
  });
});
