import type { LocalDate } from '@as/shared';
import { addDays, berlinInstant, berlinTime, diffDays, isoWeekday } from '@as/shared';
import type {
  ClockInDueInput,
  ClockOutDueInput,
  LateEntrySample,
  LateEntryStats,
  LateEntryThresholds,
  MinijobRecordingInput,
  StartSample,
} from './reminders-types';

/**
 * Üblicher Beginn (Konzept 4.6, `usualStart` im Prototyp): Median der Beginnzeiten in Europe/Berlin
 * aus Stempeluhr-Buchungen (nie Nachträge, nie ungültige) desselben Wochentags in den 56 Tagen vor
 * `date`. Je Tag zählt die früheste solche Buchung. Unter drei Werten null. Median bei gerader Anzahl
 * wie im Prototyp: das Element an Position `floor(n / 2)` der aufsteigend sortierten Minuten.
 * Ergebnis „HH:MM“.
 */
export function usualStart(samples: readonly StartSample[], date: LocalDate): string | null {
  const earliestByDay = new Map<LocalDate, Date>();
  const firstDate = addDays(date, -56);
  const weekday = isoWeekday(date);
  for (const sample of samples) {
    if (
      sample.source !== 'CLOCK' ||
      sample.voided ||
      sample.workDate < firstDate ||
      sample.workDate >= date ||
      isoWeekday(sample.workDate) !== weekday
    ) {
      continue;
    }
    const earliest = earliestByDay.get(sample.workDate);
    if (!earliest || sample.start.getTime() < earliest.getTime()) {
      earliestByDay.set(sample.workDate, sample.start);
    }
  }
  if (earliestByDay.size < 3) return null;

  const minutes = [...earliestByDay.values()]
    .map((start) => {
      const time = berlinTime(start);
      return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    })
    .sort((a, b) => a - b);
  const median = minutes[Math.floor(minutes.length / 2)];
  if (median === undefined) return null;
  return `${String(Math.floor(median / 60)).padStart(2, '0')}:${String(median % 60).padStart(2, '0')}`;
}

/**
 * Erinnerung ans Einstempeln (Konzept 4.6, Entscheidungen 3 und 6): fällig ab Beginn (gelernt oder
 * Standardzeit) + 15 Minuten in Europe/Berlin, wenn Arbeitstag, kein Feiertag, keine Abwesenheit,
 * keine Buchung und nicht stummgeschaltet. Stufe 1 einmal; Stufe 2 frühestens 60 Minuten nach
 * Stufe 1, danach keine weitere. Ergebnis: fällige Stufe oder null.
 */
export function clockInReminderDue(input: ClockInDueInput): 1 | 2 | null {
  if (!input.isWorkday || input.holiday || input.absent || input.hasEntry || input.muted) {
    return null;
  }
  if (input.stage1SentAt) {
    return !input.stage2Sent && input.now.getTime() >= input.stage1SentAt.getTime() + 60 * 60_000
      ? 2
      : null;
  }
  const start = berlinInstant(input.date, input.usualStart ?? input.defaultStart);
  // Eine durch die Sommerzeitumstellung fehlende Beginnzeit löst keine erste Erinnerung aus.
  if (!start) return null;
  return input.now.getTime() >= start.getTime() + 15 * 60_000 ? 1 : null;
}

/**
 * Erinnerung ans Ausstempeln (Entscheidung 4): offene Buchung seit mehr als 10 Stunden (> 600
 * Minuten). Stufe 1 einmal, Stufe 2 frühestens 60 Minuten nach Stufe 1.
 */
export function clockOutReminderDue(input: ClockOutDueInput): 1 | 2 | null {
  if (!input.openSince) return null;
  if (input.stage1SentAt) {
    return !input.stage2Sent && input.now.getTime() >= input.stage1SentAt.getTime() + 60 * 60_000
      ? 2
      : null;
  }
  return input.now.getTime() - input.openSince.getTime() > 600 * 60_000 ? 1 : null;
}

/**
 * Erinnerung an die Aufzeichnungsfrist der Minijobber (§ 17 Abs. 1 MiLoG, Entscheidung 4): für jeden
 * vertraglichen Arbeitstag ohne Buchung am 5., 6. und 7. Tag danach je eine Erinnerung (Stufe =
 * Tage seit dem Arbeitstag), danach keine mehr. Ergebnis aufsteigend nach Datum.
 */
export function minijobRecordingDue(
  input: MinijobRecordingInput,
): { date: LocalDate; stage: number }[] {
  return input.workDays
    .map((date) => ({ date, stage: diffDays(date, input.today) }))
    .filter(
      ({ date, stage }) =>
        stage >= 5 &&
        stage <= 7 &&
        !input.recordedDates.has(date) &&
        !input.sent.has(`${date}:${stage}`),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Auswertung der Nachträge (Konzept 4.1, `lateStats` im Prototyp, Entscheidung 8): gültige
 * Buchungen, davon Nachträge, Anteil, durchschnittlicher Verzug der Nachträge am selben Tag;
 * auffällig, wenn Nachträge ≥ `minCount` und Anteil ≥ `minPercent` (exakt verglichen).
 */
export function lateEntryStats(
  samples: readonly LateEntrySample[],
  thresholds: LateEntryThresholds,
): LateEntryStats {
  let entries = 0;
  let late = 0;
  let delaySum = 0;
  let delayCount = 0;
  for (const sample of samples) {
    if (sample.voided) continue;
    entries++;
    if (sample.source !== 'MANUAL') continue;
    late++;
    if (sample.late?.daysLate === 0 && sample.late.minutesAfterStart !== null) {
      delaySum += sample.late.minutesAfterStart;
      delayCount++;
    }
  }
  return {
    entries,
    late,
    percent: entries ? Math.round((late * 100) / entries) : 0,
    averageDelayMinutes: delayCount ? Math.round(delaySum / delayCount) : null,
    flagged: late >= thresholds.minCount && late * 100 >= thresholds.minPercent * entries,
  };
}
