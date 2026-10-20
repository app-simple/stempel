import { formatDecimal, formatEuro, formatHoursMinutes, formatLocalDate } from '@as/shared';
import { minVacationDays } from './min-vacation-days';
import type {
  EmploymentTermsInput,
  LegalValues,
  TermsValidation,
  UpcomingLegalValues,
} from './types';

/**
 * Prüft einen Vertragsstand wie `empCheck` im Prototyp.
 *
 * Rechtsgrundlagen: § 3 BUrlG (Mindesturlaub), § 3 ArbZG (Höchstarbeitszeit),
 * § 1 MiLoG (Mindestlohn), § 8 Abs. 1a SGB IV (Minijob-Grenze).
 *
 * `legal` sind die Werte am Stichtag des Vertragsstands, `upcoming` bekannte spätere Änderungen.
 * Verstöße gegen `legal` sind Fehler, Verstöße erst gegen `upcoming` sind Warnungen.
 * Die Codes und Texte stehen in der Aufgabenbeschreibung in docs/reviews/codex-tasks/time-rules.md.
 */
export function validateEmploymentTerms(
  terms: EmploymentTermsInput,
  legal: LegalValues,
  upcoming: readonly UpcomingLegalValues[] = [],
): TermsValidation {
  const result: TermsValidation = { errors: [], warnings: [], infos: [] };
  const { errors, warnings, infos } = result;
  const { workDays, weeklyMinutes, annualLeaveDays, extraLeaveDays, hourlyWageCents } = terms;
  const dayCount = new Set(workDays).size;
  const invalidWorkDays =
    dayCount !== workDays.length ||
    workDays.some((day) => !Number.isInteger(day) || day < 1 || day > 6);
  const validWorkDays = dayCount > 0 && !invalidWorkDays;
  const validWeeklyMinutes = Number.isInteger(weeklyMinutes) && weeklyMinutes > 0;
  const minimumVacation = minVacationDays(workDays);
  const isMinijob = terms.type === 'MINIJOB';
  const wageBelowMinimum = hourlyWageCents !== null && hourlyWageCents < legal.minWageHourlyCents;
  // § 8 Abs. 1a SGB IV: compare integer products before dividing or rounding to cents.
  const monthlyEarningsNumerator =
    hourlyWageCents === null ? 0 : weeklyMinutes * 13 * hourlyWageCents;
  const minijobLimitExceeded =
    isMinijob &&
    hourlyWageCents !== null &&
    validWeeklyMinutes &&
    monthlyEarningsNumerator > legal.minijobMonthlyLimitCents * 180;

  if (dayCount === 0) {
    errors.push({ code: 'NO_WORK_DAYS', text: 'Mindestens ein Arbeitstag.' });
  }
  if (invalidWorkDays) {
    errors.push({
      code: 'INVALID_WORK_DAYS',
      text: 'Arbeitstage nur von Montag bis Samstag, jeder Tag einmal.',
    });
  }
  if (!validWeeklyMinutes) {
    errors.push({
      code: 'INVALID_WEEKLY_MINUTES',
      text: 'Die Wochenarbeitszeit muss größer als 0 sein.',
    });
  }
  if (
    !Number.isInteger(annualLeaveDays) ||
    annualLeaveDays < 0 ||
    !Number.isInteger(extraLeaveDays) ||
    extraLeaveDays < 0
  ) {
    errors.push({ code: 'INVALID_LEAVE_DAYS', text: 'Urlaubstage müssen ganze Zahlen ab 0 sein.' });
  }
  if (validWorkDays && annualLeaveDays < minimumVacation) {
    errors.push({
      code: 'VACATION_BELOW_MINIMUM',
      text: `Jahresurlaub liegt unter dem gesetzlichen Minimum von ${formatDecimal(minimumVacation, 0)} Tagen.`,
      paragraph: '§ 3 BUrlG',
    });
  }
  if (validWorkDays && validWeeklyMinutes && weeklyMinutes > 600 * dayCount) {
    errors.push({
      code: 'DAILY_HOURS_ABOVE_10',
      text: 'Mehr als 10 Stunden je Arbeitstag sind nicht zulässig (§ 3 ArbZG).',
      paragraph: '§ 3 ArbZG',
    });
  }
  if (validWeeklyMinutes && weeklyMinutes > 2880) {
    errors.push({
      code: 'WEEKLY_HOURS_ABOVE_48',
      text: 'Mehr als 48 Wochenstunden sind nicht zulässig.',
      paragraph: '§ 3 ArbZG',
    });
  }
  if (isMinijob && hourlyWageCents === null) {
    errors.push({ code: 'MINIJOB_WAGE_MISSING', text: 'Stundenlohn für Minijob fehlt.' });
  }
  if (!isMinijob && hourlyWageCents !== null) {
    errors.push({
      code: 'WAGE_ONLY_FOR_MINIJOB',
      text: 'Ein Stundenlohn wird nur bei Minijob angegeben.',
    });
  }
  if (wageBelowMinimum) {
    errors.push({
      code: 'WAGE_BELOW_MINIMUM',
      text: `Stundenlohn unter dem Mindestlohn von ${formatEuro(legal.minWageHourlyCents)}.`,
      paragraph: '§ 1 MiLoG',
    });
  }
  if (minijobLimitExceeded) {
    errors.push({
      code: 'MINIJOB_LIMIT_EXCEEDED',
      text: `Die Wochenarbeitszeit führt über die Minijob-Grenze von ${formatEuro(legal.minijobMonthlyLimitCents)}.`,
      paragraph: '§ 8 Abs. 1a SGB IV',
    });
  }

  if (isMinijob && hourlyWageCents !== null) {
    const changes = [...upcoming].sort((left, right) =>
      left.validFrom < right.validFrom ? -1 : left.validFrom > right.validFrom ? 1 : 0,
    );
    for (const { validFrom, values } of changes) {
      if (!wageBelowMinimum && hourlyWageCents < values.minWageHourlyCents) {
        warnings.push({
          code: 'FUTURE_WAGE_BELOW_MINIMUM',
          text: `Ab ${formatLocalDate(validFrom)} liegt der Stundenlohn unter dem Mindestlohn von ${formatEuro(values.minWageHourlyCents)}.`,
          paragraph: '§ 1 MiLoG',
        });
      }
      if (
        !minijobLimitExceeded &&
        validWeeklyMinutes &&
        monthlyEarningsNumerator > values.minijobMonthlyLimitCents * 180
      ) {
        warnings.push({
          code: 'FUTURE_MINIJOB_LIMIT_EXCEEDED',
          text: `Ab ${formatLocalDate(validFrom)} führt die Wochenarbeitszeit über die Minijob-Grenze von ${formatEuro(values.minijobMonthlyLimitCents)}.`,
          paragraph: '§ 8 Abs. 1a SGB IV',
        });
      }
    }
  }

  if (validWorkDays && validWeeklyMinutes) {
    infos.push({
      code: 'DAILY_TARGET',
      text: `Soll je Arbeitstag: ${formatHoursMinutes(Math.round(weeklyMinutes / dayCount))} Std.`,
    });
    infos.push({
      code: 'MIN_VACATION',
      text: `Gesetzlicher Mindesturlaub bei ${formatDecimal(dayCount, 0)} ${dayCount === 1 ? 'Tag' : 'Tagen'}/Woche: ${formatDecimal(minimumVacation, 0)} Tage (§ 3 BUrlG).`,
      paragraph: '§ 3 BUrlG',
    });
    if (weeklyMinutes > 480 * dayCount && weeklyMinutes <= 600 * dayCount) {
      infos.push({
        code: 'DAILY_HOURS_ABOVE_8',
        text: 'Über 8 Stunden je Tag: nur mit Ausgleich auf durchschnittlich 8 Stunden zulässig.',
        paragraph: '§ 3 ArbZG',
      });
    }
    if (isMinijob && hourlyWageCents !== null && hourlyWageCents > 0) {
      const maximumMonthlyHours = legal.minijobMonthlyLimitCents / hourlyWageCents;
      const plannedMonthlyHours = (weeklyMinutes * 13) / 180;
      infos.push({
        code: 'MINIJOB_CAPACITY',
        text: `Minijob: höchstens ${formatDecimal(maximumMonthlyHours, 1)} Std./Monat bei ${formatEuro(hourlyWageCents)}. Geplant sind rund ${formatDecimal(plannedMonthlyHours, 1)} Std./Monat (${formatEuro(Math.round(monthlyEarningsNumerator / 180))}).`,
      });
    }
  }

  return result;
}
