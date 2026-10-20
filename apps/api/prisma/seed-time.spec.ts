import { isoWeekday, type LocalDate } from '@as/shared';
import { bavarianHolidays } from '@as/time-rules';
import type { Prisma } from '../src/generated/prisma/client';
import { seedEmployees } from './seed-data';
import { seedTimeEntries } from './seed-time';

type Entry = Prisma.TimeEntryUncheckedCreateInput;
const employeeIds = new Map(seedEmployees.map((employee) => [employee.id, `db-${employee.id}`]));

async function generate(today: LocalDate = '2026-10-12'): Promise<Entry[]> {
  const entries: Entry[] = [];
  const tx = {
    timeEntry: {
      create: async ({ data }: { data: Entry }) => {
        entries.push(data);
      },
    },
  };
  await seedTimeEntries(tx, employeeIds, today);
  return entries;
}

function on(entries: Entry[], employee: string, date: string): Entry | undefined {
  return entries.find(
    (entry) =>
      entry.employeeId === `db-${employee}` &&
      (entry.workDate as Date).toISOString().slice(0, 10) === date,
  );
}

describe('Seed-Zeitbuchungen ohne Datenbank', () => {
  afterEach(() => jest.restoreAllMocks());

  it('erzeugt zweimal dieselben Buchungen mit der Zufallsfolge des Prototyps', async () => {
    const entries = await generate();
    expect(entries).toEqual(await generate());
    expect(entries).toHaveLength(257);
    expect(on(entries, 'e1', '2026-08-31')).toMatchObject({
      startAt: new Date('2026-08-31T05:30:00Z'),
      endAt: new Date('2026-08-31T13:40:00Z'),
      breaks: {
        create: [
          { startAt: new Date('2026-08-31T10:00:00Z'), endAt: new Date('2026-08-31T10:30:00Z') },
        ],
      },
    });
    // Referenzwerte direkt aus dem Prototyp, auch nach Urlaub und entfernten Buchungen.
    expect(on(entries, 'e6', '2026-08-31')).toMatchObject({
      startAt: new Date('2026-08-31T06:00:00Z'),
      endAt: new Date('2026-08-31T14:10:00Z'),
    });
    expect(on(entries, 'e8', '2026-10-09')).toMatchObject({
      startAt: new Date('2026-10-09T06:15:00Z'),
      endAt: new Date('2026-10-09T12:15:00Z'),
      breaks: { create: [] },
    });
  });

  it('lässt vertragsfreie Tage und Elifs genehmigten Urlaub aus', async () => {
    const entries = await generate();
    for (const employee of seedEmployees) {
      for (const entry of entries.filter(
        (candidate) => candidate.employeeId === employeeIds.get(employee.id),
      )) {
        const date = (entry.workDate as Date).toISOString().slice(0, 10);
        expect(employee.terms.workDays).toContain(isoWeekday(date));
      }
    }
    for (const day of ['07', '08', '09', '10', '11']) {
      expect(on(entries, 'e5', `2026-09-${day}`)).toBeUndefined();
    }
    expect(on(entries, 'm1', '2026-09-18')).toBeUndefined();
    expect(entries.filter((entry) => entry.employeeId === 'db-m1')).toHaveLength(12);
    expect(on(entries, 'm1', '2026-09-01')).toMatchObject({
      startAt: new Date('2026-09-01T06:30:00Z'),
      endAt: new Date('2026-09-01T10:30:00Z'),
      breaks: { create: [] },
    });
  });

  it('lässt den 03.10. auch bei einem vertraglichen Samstag frei', async () => {
    const employee = seedEmployees[0];
    if (!employee) throw new Error('Seed-Testdaten fehlen.');
    jest.replaceProperty(employee.terms, 'workDays', [6]);
    jest.replaceProperty(employee.terms, 'weeklyMinutes', 480);
    const entries = await generate();
    expect(on(entries, 'e1', '2026-10-03')).toBeUndefined();
    expect(on(entries, 'e1', '2026-09-26')).toBeDefined();
    expect(on(entries, 'e1', '2026-10-10')).toBeDefined();
  });

  it('lässt Feiertage und Wochenenden für Vollzeit aus', async () => {
    const entries = await generate();
    const holidays = new Set(
      bavarianHolidays(2026, { assumptionDay: true }).map((day) => day.date),
    );
    for (const entry of entries) {
      const date = (entry.workDate as Date).toISOString().slice(0, 10);
      expect(holidays.has(date)).toBe(false);
      if (
        seedEmployees.some(
          (employee) =>
            employeeIds.get(employee.id) === entry.employeeId &&
            employee.terms.type === 'FULL_TIME',
        )
      ) {
        expect(isoWeekday(date)).toBeLessThanOrEqual(5);
      }
    }
  });

  it('enthält Miriams und Elifs Abweichungen sowie Lenas fehlenden Tag', async () => {
    const entries = await generate();
    expect(on(entries, 'e3', '2026-10-07')).toMatchObject({
      startAt: new Date('2026-10-07T05:00:00Z'),
      endAt: new Date('2026-10-07T16:45:00Z'),
      breaks: {
        create: [
          { startAt: new Date('2026-10-07T10:00:00Z'), endAt: new Date('2026-10-07T10:45:00Z') },
        ],
      },
    });
    expect(on(entries, 'e3', '2026-10-08')).toMatchObject({
      startAt: new Date('2026-10-08T03:30:00Z'),
      endAt: new Date('2026-10-08T12:15:00Z'),
      breaks: {
        create: [
          { startAt: new Date('2026-10-08T10:00:00Z'), endAt: new Date('2026-10-08T10:45:00Z') },
        ],
      },
    });
    expect(on(entries, 'e5', '2026-10-08')).toMatchObject({
      startAt: new Date('2026-10-08T06:00:00Z'),
      endAt: new Date('2026-10-08T13:00:00Z'),
      breaks: { create: [] },
    });
    expect(on(entries, 'e7', '2026-10-06')).toBeUndefined();
  });

  it('erfasst genau die acht vorgegebenen Tage für Marco als eigene Nachträge', async () => {
    const entries = await generate();
    const manual = entries.filter(
      (entry) => entry.employeeId === 'db-e8' && entry.source === 'MANUAL',
    );
    expect(manual).toHaveLength(8);
    const dates = ['09-15', '09-17', '09-22', '09-24', '09-29', '10-01', '10-06', '10-08'];
    dates.forEach((date, index) => {
      expect(on(manual, 'e8', `2026-${date}`)).toMatchObject({
        recordedAt: new Date(`2026-${date}T08:${String(index * 3).padStart(2, '0')}:00Z`),
        recordedById: 'db-e8',
        reason: 'Stempeln vergessen',
      });
    });
  });

  it('erfasst Pauls verspäteten Stundenzettel und Hannelores Dreistundentermine', async () => {
    const entries = await generate();
    expect(entries.filter((entry) => entry.employeeId === 'db-m2')).toHaveLength(6);
    expect(on(entries, 'm2', '2026-09-30')).toMatchObject({
      source: 'MANUAL',
      recordedAt: new Date('2026-10-09T17:00:00Z'),
      recordedById: 'db-m2',
      reason: 'Stundenzettel zu spät abgegeben',
    });
    const cleaning = entries.filter((entry) => entry.employeeId === 'db-m3');
    expect(cleaning).toHaveLength(17);
    for (const entry of cleaning) {
      const date = (entry.workDate as Date).toISOString().slice(0, 10);
      expect(entry).toMatchObject({
        startAt: new Date(`${date}T15:00:00Z`),
        endAt: new Date(`${date}T18:00:00Z`),
        breaks: { create: [] },
      });
    }
  });

  it.each(['2026-09-01', '2026-09-30', '2026-10-07', '2026-10-08', '2026-10-09', '2027-01-01'])(
    'schreibt bei Lauf am %s ausschließlich abgeschlossene Buchungen vor diesem Tag und bis 11.10.',
    async (today) => {
      const entries = await generate(today);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        const date = (entry.workDate as Date).toISOString().slice(0, 10);
        expect(date >= '2026-08-31' && date < today && date <= '2026-10-11').toBe(true);
        expect(entry.endAt).toBeInstanceOf(Date);
        expect((entry.endAt as Date).getTime()).toBeGreaterThan((entry.startAt as Date).getTime());
        if (entry.source === 'CLOCK') {
          expect(entry.recordedAt).toEqual(entry.endAt);
          expect(entry.recordedById).toBe(entry.employeeId);
        }
      }
    },
  );

  it.each(['2026-08-30', '2026-08-31'])('erzeugt am %s noch keine Buchungen', async (today) => {
    expect(await generate(today)).toEqual([]);
  });

  it('beachtet den Eintritt auch für Sonderfälle und Minijobtermine', async () => {
    for (const employee of seedEmployees) jest.replaceProperty(employee, 'entryDate', '2026-10-09');
    const entries = await generate();
    expect(entries.length).toBeGreaterThan(0);
    expect(
      entries.every((entry) => (entry.workDate as Date).toISOString().slice(0, 10) >= '2026-10-09'),
    ).toBe(true);
  });
});
