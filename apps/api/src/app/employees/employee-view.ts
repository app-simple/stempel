import type {
  AdminEmployeeView,
  ApiMessage,
  EmployeeStatus,
  EmployeeView,
  IsoWeekday,
  LocalDate,
  Role,
  TermsView,
} from '@as/shared';
import { formatLocalDate } from '@as/shared';
import {
  dailyTargetMinutes,
  minVacationDays,
  validateEmploymentTerms,
  youthVacationError,
  type LegalValues,
  type UpcomingLegalValues,
} from '@as/time-rules';
import type { EmploymentTerms, Employee, LeaveCarryOver } from '../../generated/prisma/client';
import { toLocalDate } from '../common/dates';

export type EmployeeRow = Employee & {
  lead: { name: string } | null;
  deputy: { name: string } | null;
  terms: EmploymentTerms[];
  carryOvers: LeaveCarryOver[];
};

export const employeeInclude = (year: number) =>
  ({
    lead: { select: { name: true } },
    deputy: { select: { name: true } },
    terms: { orderBy: { validFrom: 'asc' as const } },
    carryOvers: { where: { year } },
  }) as const;

export function toTermsView(terms: EmploymentTerms, today: LocalDate): TermsView {
  const workDays = terms.workDays as IsoWeekday[];
  return {
    id: terms.id,
    validFrom: toLocalDate(terms.validFrom),
    type: terms.type,
    weeklyMinutes: terms.weeklyMinutes,
    workDays,
    annualLeaveDays: terms.annualLeaveDays,
    extraLeaveDays: terms.extraLeaveDays,
    hourlyWageCents: terms.hourlyWageCents,
    dailyTargetMinutes: dailyTargetMinutes({
      type: terms.type,
      weeklyMinutes: terms.weeklyMinutes,
      workDays,
    }),
    minVacationDays: minVacationDays(workDays),
    editable: toLocalDate(terms.validFrom) > today,
  };
}

/** Geltender Stand am Stichtag; bei künftigem Eintritt der erste künftige Stand. */
export function currentTerms(terms: EmploymentTerms[], today: LocalDate): EmploymentTerms | null {
  const valid = terms.filter((t) => toLocalDate(t.validFrom) <= today);
  return valid.at(-1) ?? terms[0] ?? null;
}

export function employeeStatus(
  e: Pick<Employee, 'lockedAt' | 'exitDate'>,
  today: LocalDate,
): EmployeeStatus {
  if (e.exitDate && toLocalDate(e.exitDate) < today) return 'EXITED';
  if (e.lockedAt) return 'LOCKED';
  return 'ACTIVE';
}

export interface LegalContext {
  current: LegalValues | null;
  upcoming: UpcomingLegalValues[];
}

/** Verstöße und künftige Verstöße des geltenden Stands gegen die heutigen und bekannten Werte. */
function termsWarnings(terms: EmploymentTerms | null, legal: LegalContext): ApiMessage[] {
  if (!terms || !legal.current) return [];
  const result = validateEmploymentTerms(
    {
      type: terms.type,
      weeklyMinutes: terms.weeklyMinutes,
      workDays: terms.workDays as IsoWeekday[],
      annualLeaveDays: terms.annualLeaveDays,
      extraLeaveDays: terms.extraLeaveDays,
      hourlyWageCents: terms.hourlyWageCents,
    },
    legal.current,
    legal.upcoming,
  );
  return [...result.errors, ...result.warnings];
}

export function toEmployeeView(
  row: EmployeeRow,
  today: LocalDate,
  legal: LegalContext,
): EmployeeView {
  const terms = currentTerms(row.terms, today);
  const carry = row.carryOvers[0];
  return {
    id: row.id,
    name: row.name,
    jobTitle: row.jobTitle,
    role: row.role as Role,
    leadId: row.leadId,
    leadName: row.lead?.name ?? null,
    deputyId: row.deputyId,
    deputyName: row.deputy?.name ?? null,
    entryDate: toLocalDate(row.entryDate),
    exitDate: row.exitDate ? toLocalDate(row.exitDate) : null,
    status: employeeStatus(row, today),
    currentTerms: terms ? toTermsView(terms, today) : null,
    carryOver: carry ? { year: carry.year, days: carry.days } : null,
    warnings: termsWarnings(terms, legal),
  };
}

/** Eigenes Profil: Anmeldeadresse ja, Geburtsdatum und Schulpflicht nein (nur Admin, Phase 7). */
export function toOwnEmployeeView(
  row: EmployeeRow,
  today: LocalDate,
  legal: LegalContext,
): Omit<AdminEmployeeView, 'birthDate' | 'fullTimeSchoolUntil'> {
  return {
    ...toEmployeeView(row, today, legal),
    loginEmail: row.loginEmail,
    certificateFromDay1: row.certificateFromDay1,
  };
}

export function toAdminEmployeeView(
  row: EmployeeRow,
  today: LocalDate,
  legal: LegalContext,
): AdminEmployeeView {
  const view = toOwnEmployeeView(row, today, legal);
  const birthDate = row.birthDate ? toLocalDate(row.birthDate) : null;
  // Jugendmindesturlaub nur in der Admin-Ansicht (Phase 7, Review Focus 4): verrät das Alter. Geprüft wird
  // jeder Vertragsstand nach dem Alter am 1.1. seines ersten Geltungsjahres (Review API, Befund 4).
  const youth = row.terms.flatMap((terms) => {
    const validFrom = toLocalDate(terms.validFrom);
    const error = youthVacationError(
      {
        validFrom,
        workDays: terms.workDays as IsoWeekday[],
        annualLeaveDays: terms.annualLeaveDays,
      },
      birthDate,
    );
    return error
      ? [
          {
            code: error.code,
            text: `Vertragsstand ab ${formatLocalDate(validFrom)}: ${error.text}`,
          },
        ]
      : [];
  });
  return {
    ...view,
    warnings: [...view.warnings, ...youth],
    birthDate,
    fullTimeSchoolUntil: row.fullTimeSchoolUntil ? toLocalDate(row.fullTimeSchoolUntil) : null,
  };
}
