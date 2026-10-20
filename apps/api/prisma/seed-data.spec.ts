import { isLocalDate } from '@as/shared';
import { validateEmploymentTerms } from '@as/time-rules';
import { seedEmployees } from './seed-data';

describe('Seed-Beispieldaten', () => {
  it('enthält elf Personen mit genau einem Admin und zwei Vorgesetzten', () => {
    expect(seedEmployees).toHaveLength(11);
    expect(new Set(seedEmployees.map((employee) => employee.id)).size).toBe(11);
    expect(seedEmployees.filter((employee) => employee.role === 'ADMIN')).toHaveLength(1);
    expect(seedEmployees.filter((employee) => employee.role === 'LEAD')).toHaveLength(2);

    for (const employee of seedEmployees) {
      if (employee.role === 'ADMIN') {
        expect(employee.leadId).toBeNull();
      } else {
        const lead = seedEmployees.find((candidate) => candidate.id === employee.leadId);
        expect(lead).toBeDefined();
        expect(['LEAD', 'ADMIN']).toContain(lead?.role);
        expect(employee.leadId).not.toBe(employee.id);
      }
    }
  });

  it('verwendet eindeutige, kleingeschriebene Adressen unter reservierten Domains', () => {
    expect(new Set(seedEmployees.map((employee) => employee.loginEmail)).size).toBe(11);
    for (const employee of seedEmployees) {
      expect(employee.loginEmail).toBe(employee.loginEmail.toLowerCase());
      expect(employee.loginEmail).toMatch(/^[a-z]+\.[a-z]+@example\.(com|org)$/);
      expect(employee.loginEmail.split('@')[1]).toBe(
        employee.terms.type === 'MINIJOB' ? 'example.org' : 'example.com',
      );
    }
    expect(seedEmployees.find((employee) => employee.name === 'Anna Kroiß')?.loginEmail).toBe(
      'anna.kroiss@example.org',
    );
  });

  it('enthält ausschließlich gültige Vertragsstände mit gesetzlichen Werten ab 2026', () => {
    for (const employee of seedEmployees) {
      expect(isLocalDate(employee.entryDate)).toBe(true);
      expect(employee.terms.validFrom).toBe(
        employee.entryDate > '2026-01-01' ? employee.entryDate : '2026-01-01',
      );
      expect(employee.terms.extraLeaveDays).toBe(0);
      expect(
        validateEmploymentTerms(employee.terms, {
          minWageHourlyCents: 1390,
          minijobMonthlyLimitCents: 60300,
        }).errors,
      ).toEqual([]);
    }
  });

  it('begrenzt Hannelore Fuchs auf 540 Wochenminuten', () => {
    expect(
      seedEmployees.find((employee) => employee.name === 'Hannelore Fuchs')?.terms.weeklyMinutes,
    ).toBe(540);
  });

  it('überträgt ausschließlich für Jonas Reitberger zwei Tage nach 2026', () => {
    const carryOvers = seedEmployees.filter((employee) => employee.carryOver !== null);
    expect(carryOvers).toHaveLength(1);
    expect(carryOvers[0]).toMatchObject({
      name: 'Jonas Reitberger',
      carryOver: { year: 2026, days: 2 },
    });
  });
});
