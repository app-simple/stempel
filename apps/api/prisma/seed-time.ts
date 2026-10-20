import { addDays, berlinInstant, isoWeekday, type LocalDate } from '@as/shared';
import { bavarianHolidays, dailyTargetMinutes } from '@as/time-rules';
import type { Prisma } from '../src/generated/prisma/client';
import { fromLocalDate } from '../src/app/common/dates';
import { seedEmployees, type SeedEmployee } from './seed-data';

type SeedTransaction = {
  timeEntry: {
    create(args: { data: Prisma.TimeEntryUncheckedCreateInput }): Promise<unknown>;
  };
};

const manualDates = [
  '2026-09-15',
  '2026-09-17',
  '2026-09-22',
  '2026-09-24',
  '2026-09-29',
  '2026-10-01',
  '2026-10-06',
  '2026-10-08',
];

const minijobAppointments = [
  {
    id: 'm1',
    start: 510,
    end: 750,
    dates: [
      '09-01',
      '09-03',
      '09-08',
      '09-10',
      '09-15',
      '09-17',
      '09-18',
      '09-22',
      '09-24',
      '09-29',
      '10-01',
      '10-06',
      '10-08',
    ],
  },
  {
    id: 'm2',
    start: 840,
    end: 1140,
    dates: ['09-02', '09-09', '09-16', '09-23', '09-30', '10-07'],
  },
  {
    id: 'm3',
    start: 1020,
    end: 1200,
    dates: [
      '09-02',
      '09-04',
      '09-07',
      '09-09',
      '09-11',
      '09-14',
      '09-16',
      '09-18',
      '09-21',
      '09-23',
      '09-25',
      '09-28',
      '09-30',
      '10-02',
      '10-05',
      '10-07',
      '10-09',
    ],
  },
];

function instant(date: LocalDate, minutes: number): Date {
  const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const result = berlinInstant(date, time);
  if (!result) throw new RangeError('Seed-Zeit existiert in Europe/Berlin nicht.');
  return result;
}

/** Nur Beispielbuchungen; der Aufrufer legt Mitarbeiter und Verträge in derselben Transaktion an. */
export async function seedTimeEntries(
  tx: SeedTransaction,
  employeesByPrototypeId: ReadonlyMap<string, string>,
  today: LocalDate,
): Promise<void> {
  const yesterday = addDays(today, -1);
  const lastDate = yesterday < '2026-10-11' ? yesterday : '2026-10-11';
  const holidays = new Set(bavarianHolidays(2026, { assumptionDay: true }).map((day) => day.date));
  const canBook = (employee: SeedEmployee, date: LocalDate): boolean =>
    date >= '2026-08-31' &&
    date <= lastDate &&
    date >= employee.entryDate &&
    date >= employee.terms.validFrom &&
    employee.terms.workDays.includes(isoWeekday(date)) &&
    !holidays.has(date);

  // Zufallsfolge und Mitarbeiter-/Tagesreihenfolge entsprechen prototype/index.html, seed().
  let s = 7;
  const random = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const variations = [-20, -10, 0, 0, 10];

  const write = async (
    employee: SeedEmployee,
    date: LocalDate,
    start: number,
    end: number,
    pause: number,
    manual?: { date: LocalDate; minutes: number; reason: string },
  ): Promise<void> => {
    const employeeId = employeesByPrototypeId.get(employee.id);
    if (!employeeId) throw new Error('Seed abgebrochen: Mitarbeiterreferenz fehlt.');
    const endAt = instant(date, end);
    await tx.timeEntry.create({
      data: {
        employeeId,
        workDate: fromLocalDate(date),
        startAt: instant(date, start),
        endAt,
        source: manual ? 'MANUAL' : 'CLOCK',
        recordedAt: manual ? instant(manual.date, manual.minutes) : endAt,
        recordedById: employeeId,
        reason: manual?.reason ?? null,
        breaks: {
          create:
            pause > 0 ? [{ startAt: instant(date, 720), endAt: instant(date, 720 + pause) }] : [],
        },
      },
    });
  };

  for (const employee of seedEmployees) {
    const target = dailyTargetMinutes(employee.terms);
    if (!target) continue;
    for (let date = '2026-08-31'; date <= lastDate; date = addDays(date, 1)) {
      if (!canBook(employee, date)) continue;
      // Einziger genehmigter Urlaub im Demo-Zeitraum; soll() im Prototyp liefert hier null.
      if (employee.id === 'e5' && date >= '2026-09-07' && date <= '2026-09-11') continue;
      let start = 450 + Math.floor(random() * 5) * 15;
      const duration = target + (variations[Math.floor(random() * 5)] ?? 0);
      let pause = duration > 540 ? 45 : duration > 360 ? 30 : 0;
      let end = start + duration + pause;
      // Auch ersetzte/entfernte Buchungen verbrauchen im Prototyp beide Zufallswerte.
      if (employee.id === 'e7' && date === '2026-10-06') continue;
      if (employee.id === 'e3' && date === '2026-10-07') {
        start = 420;
        end = 1125;
        pause = 45;
      } else if (employee.id === 'e3' && date === '2026-10-08') {
        start = 330;
        end = 855;
        pause = 45;
      } else if (employee.id === 'e5' && date === '2026-10-08') {
        start = 480;
        end = 900;
        pause = 0;
      }
      const manualIndex = employee.id === 'e8' ? manualDates.indexOf(date) : -1;
      await write(
        employee,
        date,
        start,
        end,
        pause,
        manualIndex < 0
          ? undefined
          : {
              date,
              minutes: 600 + manualIndex * 3,
              reason: 'Stempeln vergessen',
            },
      );
    }
  }

  for (const appointments of minijobAppointments) {
    const employee = seedEmployees.find((candidate) => candidate.id === appointments.id);
    if (!employee) throw new Error('Seed abgebrochen: Minijob-Referenz fehlt.');
    for (const day of appointments.dates) {
      const date = `2026-${day}`;
      // Insbesondere entfällt Annas zusätzlicher Freitag (18.09.) außerhalb ihrer Vertragstage.
      if (!canBook(employee, date)) continue;
      await write(
        employee,
        date,
        appointments.start,
        appointments.end,
        0,
        employee.id === 'm2' && date === '2026-09-30'
          ? {
              // Der Prototyp nennt nur das Erfassungsdatum; als Uhrzeit gilt das Schichtende.
              date: '2026-10-09',
              minutes: appointments.end,
              reason: 'Stundenzettel zu spät abgegeben',
            }
          : undefined,
      );
    }
  }
}
