import type {
  EmploymentType,
  IsoWeekday,
  LegalParameterKey,
  LocalDate,
  LoginMethod,
  Role,
} from './domain';

/** Gemeinsame Antworttypen von API und Web. */

export interface ApiMessage {
  code: string;
  text: string;
  paragraph?: string;
}

export interface SessionView {
  id: string;
  name: string;
  role: Role;
  method: LoginMethod;
}

export type EmployeeStatus = 'ACTIVE' | 'LOCKED' | 'EXITED';

export interface TermsView {
  id: string;
  validFrom: LocalDate;
  type: EmploymentType;
  weeklyMinutes: number;
  workDays: IsoWeekday[];
  annualLeaveDays: number;
  extraLeaveDays: number;
  hourlyWageCents: number | null;
  dailyTargetMinutes: number | null;
  minVacationDays: number;
  /** Nur künftige Stände lassen sich ändern oder löschen. */
  editable: boolean;
}

export interface EmployeeView {
  id: string;
  name: string;
  jobTitle: string | null;
  role: Role;
  leadId: string | null;
  leadName: string | null;
  deputyId: string | null;
  deputyName: string | null;
  entryDate: LocalDate;
  exitDate: LocalDate | null;
  status: EmployeeStatus;
  currentTerms: TermsView | null;
  carryOver: { year: number; days: number } | null;
  /** Hinweise zu bekannten künftigen gesetzlichen Werten, z. B. Mindestlohn ab 01.01.2027. */
  warnings: ApiMessage[];
}

/** Nur in Admin-Antworten und im eigenen Profil. */
export interface AdminEmployeeView extends EmployeeView {
  loginEmail: string;
  /** AU schon ab dem 1. Krankheitstag verlangt (Phase 6, § 5 Abs. 1 Satz 3 EFZG). */
  certificateFromDay1: boolean;
  /** Jugendarbeitsschutz (Phase 7): nur in Admin-Antworten. */
  birthDate: LocalDate | null;
  fullTimeSchoolUntil: LocalDate | null;
}

/** Ohne Geburtsdatum und Schulpflicht: beides sieht nur der Admin (Phase 7, Abschnitt 2). */
export interface ProfileView extends Omit<AdminEmployeeView, 'birthDate' | 'fullTimeSchoolUntil'> {
  passkeyCount: number;
  /** Anzahl der Personen, die man heute als Vertretung vertritt (Phase 3, Entscheidung 7). */
  representing: number;
  /** Erinnerungen per E-Mail, wenn kein Gerät für Push angemeldet ist (Phase 5, Entscheidung 5). */
  reminderEmailFallback: boolean;
}

export interface TermsInput {
  validFrom: LocalDate;
  type: EmploymentType;
  weeklyMinutes: number;
  workDays: IsoWeekday[];
  annualLeaveDays: number;
  extraLeaveDays: number;
  hourlyWageCents: number | null;
}

export interface EmployeeCreateInput {
  name: string;
  jobTitle: string | null;
  role: Role;
  loginEmail: string;
  leadId: string | null;
  deputyId: string | null;
  entryDate: LocalDate;
  exitDate: LocalDate | null;
  /** Jugendarbeitsschutz (Phase 7), nur Admin. */
  birthDate?: LocalDate | null;
  fullTimeSchoolUntil?: LocalDate | null;
  terms: TermsInput;
  carryOverDays: number;
}

export type EmployeeUpdateInput = Partial<Omit<EmployeeCreateInput, 'terms' | 'carryOverDays'>>;

export interface TermsSaveResult {
  terms: TermsView;
  warnings: ApiMessage[];
  infos: ApiMessage[];
}

/** Antwort 422, wenn ein Vertragsstand gegen Regeln verstößt. */
export interface TermsRejection {
  statusCode: 422;
  message: string;
  errors: ApiMessage[];
  warnings: ApiMessage[];
  infos: ApiMessage[];
}

export interface HolidayView {
  id: string;
  date: LocalDate;
  name: string;
  origin: 'STATUTORY' | 'MANUAL';
  active: boolean;
  editable: boolean;
}

export interface CompanySettingsView {
  state: string;
  assumptionDayIsHoliday: boolean;
}

export interface LegalParameterView {
  key: LegalParameterKey;
  value: number;
  validFrom: LocalDate;
  source: string;
}

export interface AuditLogView {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: unknown;
}

export interface PasskeyView {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
}

/** Schulferien (Phase 7), für alle Angemeldeten lesbar. */
export interface SchoolHolidayView {
  id: string;
  name: string;
  from: LocalDate;
  to: LocalDate;
  active: boolean;
}
