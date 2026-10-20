/** Kalendertag ohne Uhrzeit im Format YYYY-MM-DD, immer als lokales Datum in Europe/Berlin gemeint. */
export type LocalDate = string;

/** ISO-Wochentag: 1 = Montag … 7 = Sonntag. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const ROLES = ['EMPLOYEE', 'LEAD', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'MINIJOB'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const LOGIN_METHODS = ['EMAIL_CODE', 'PASSKEY'] as const;
export type LoginMethod = (typeof LOGIN_METHODS)[number];

export const LEGAL_PARAMETER_KEYS = [
  'MIN_WAGE_HOURLY_CENTS',
  'MINIJOB_MONTHLY_LIMIT_CENTS',
] as const;
export type LegalParameterKey = (typeof LEGAL_PARAMETER_KEYS)[number];

/** Bezeichnungen in der Oberfläche, wie im Prototyp. */
export const ROLE_LABELS: Record<Role, string> = {
  EMPLOYEE: 'Mitarbeiter/in',
  LEAD: 'Vorgesetzte/r',
  ADMIN: 'Admin',
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  FULL_TIME: 'Vollzeit',
  PART_TIME: 'Teilzeit',
  MINIJOB: 'Minijob',
};

export const WEEKDAY_SHORT: Record<IsoWeekday, string> = {
  1: 'Mo',
  2: 'Di',
  3: 'Mi',
  4: 'Do',
  5: 'Fr',
  6: 'Sa',
  7: 'So',
};

/** Abwesenheitsarten (Spezifikation Phase 3, Entscheidung 1). */
export const ABSENCE_TYPES = ['VACATION', 'OVERTIME_OFF', 'SPECIAL_LEAVE'] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

export const ABSENCE_TYPE_LABELS: Record<AbsenceType, string> = {
  VACATION: 'Urlaub',
  OVERTIME_OFF: 'Überstundenabbau',
  SPECIAL_LEAVE: 'Sonderurlaub',
};

/**
 * Arten einer Krankmeldung (Spezifikation Phase 6, Abschnitt 3). NEUTRAL nach Ablauf der Löschfrist:
 * erscheint überall nur als „abwesend“.
 */
export const SICK_KINDS = ['SICK', 'CHILD_SICK', 'NEUTRAL'] as const;
export type SickKind = (typeof SICK_KINDS)[number];

export const SICK_KIND_LABELS: Record<SickKind, string> = {
  SICK: 'krank',
  CHILD_SICK: 'Kind krank',
  NEUTRAL: 'abwesend',
};

/** Beschriftung jeder Abwesenheit eines Tages, Urlaubsarten und Krankheit. */
export const DAY_ABSENCE_LABELS: Record<AbsenceType | SickKind, string> = {
  ...ABSENCE_TYPE_LABELS,
  ...SICK_KIND_LABELS,
};

export const LEAVE_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
  'CANCELLED',
] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  PENDING: 'beantragt',
  APPROVED: 'genehmigt',
  REJECTED: 'abgelehnt',
  WITHDRAWN: 'zurückgezogen',
  CANCELLED: 'storniert',
};
