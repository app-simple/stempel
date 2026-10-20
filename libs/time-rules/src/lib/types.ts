import type { EmploymentType, IsoWeekday, LocalDate } from '@as/shared';

/** Vertragsstand, soweit die Regeln ihn brauchen. Geld in Cent, Zeit in Minuten. */
export interface EmploymentTermsInput {
  type: EmploymentType;
  weeklyMinutes: number;
  /** ISO-Wochentage, zulässig sind 1 (Mo) bis 6 (Sa). */
  workDays: readonly IsoWeekday[];
  annualLeaveDays: number;
  extraLeaveDays: number;
  /** Nur bei Minijob, sonst null. */
  hourlyWageCents: number | null;
}

/** Gesetzliche Werte zu einem Stichtag, aus `LegalParameter` geladen. */
export interface LegalValues {
  minWageHourlyCents: number;
  minijobMonthlyLimitCents: number;
}

/** Bekannte künftige Änderung der gesetzlichen Werte nach dem Stichtag. */
export interface UpcomingLegalValues {
  validFrom: LocalDate;
  values: LegalValues;
}

export interface RuleMessage {
  /** Stabiler Code für API und Tests. */
  code: string;
  /** Deutscher Text für die Oberfläche. */
  text: string;
  /** Rechtsgrundlage, falls es eine gibt, z. B. „§ 3 BUrlG“. */
  paragraph?: string;
}

export interface TermsValidation {
  /** Blockieren das Speichern. */
  errors: RuleMessage[];
  /** Blockieren nicht: Verstöße, die erst durch bekannte künftige Werte entstehen. */
  warnings: RuleMessage[];
  /** Abgeleitete Angaben wie Soll je Tag und Mindesturlaub. */
  infos: RuleMessage[];
}

export interface HolidayDefinition {
  date: LocalDate;
  name: string;
  key: BavarianHolidayKey;
}

export type BavarianHolidayKey =
  | 'NEW_YEAR'
  | 'EPIPHANY'
  | 'GOOD_FRIDAY'
  | 'EASTER_MONDAY'
  | 'LABOUR_DAY'
  | 'ASCENSION_DAY'
  | 'WHIT_MONDAY'
  | 'CORPUS_CHRISTI'
  | 'ASSUMPTION_DAY'
  | 'GERMAN_UNITY_DAY'
  | 'ALL_SAINTS_DAY'
  | 'CHRISTMAS_DAY'
  | 'BOXING_DAY';

export interface BavarianHolidayOptions {
  /** Mariä Himmelfahrt (15.08.), in Bayern gemeindeabhängig. */
  assumptionDay: boolean;
}
