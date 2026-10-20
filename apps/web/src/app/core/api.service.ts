import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  AdminEmployeeView,
  ApiMessage,
  CompanySettingsView,
  EmployeeCreateInput,
  EmployeeUpdateInput,
  EmployeeView,
  HolidayView,
  SchoolHolidayView,
  LegalParameterView,
  PasskeyView,
  ProfileView,
  SessionView,
  TermsInput,
  TermsSaveResult,
  TermsView,
  ClockResult,
  CorrectionInput,
  CorrectionRequestView,
  CorrectionResult,
  EntrySaveResult,
  ManualEntryInput,
  MonthClosingView,
  MonthView,
  OvertimeView,
  RevisionView,
  TeamTodayRow,
  TodayView,
  WeekView,
  LeaveAccountView,
  LeaveCalendarView,
  LeaveInput,
  LeaveLedgerInput,
  LeaveLedgerView,
  LeavePreview,
  LeaveRequestView,
  LeaveStatus,
  ChecksView,
  ForfeitureKind,
  ForfeitureSuggestion,
  LeaveNoticeView,
  RetentionSettingsView,
  LateEntriesView,
  PushDeviceView,
  PushSubscriptionInput,
  ReminderSettingsView,
  ReminderTodayView,
  SickLeaveView,
  SickLeaveInput,
  SickLeaveUpdate,
  SickChecksView,
  LocalDate,
} from '@as/shared';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { firstValueFrom, type Observable } from 'rxjs';

/** Fehler der API mit deutscher Meldung und, bei 422, den Regelmeldungen. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors: ApiMessage[] = [],
    readonly warnings: ApiMessage[] = [],
  ) {
    super(message);
  }
}

function toApiError(error: unknown): ApiError {
  if (!(error instanceof HttpErrorResponse)) return new ApiError(0, 'Unerwarteter Fehler.');
  if (error.status === 0) return new ApiError(0, 'Keine Verbindung zum Server.');
  const body = (error.error ?? {}) as {
    message?: string | string[];
    errors?: ApiMessage[];
    warnings?: ApiMessage[];
  };
  const message = Array.isArray(body.message)
    ? body.message.join(' ')
    : (body.message ?? 'Die Anfrage ist fehlgeschlagen.');
  return new ApiError(error.status, message, body.errors ?? [], body.warnings ?? []);
}

/** Alle Aufrufe der API an einer Stelle. Gleicher Ursprung, das Sitzungscookie geht automatisch mit. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  private async call<T>(request: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (error) {
      throw toApiError(error);
    }
  }

  // Anmeldung
  session = () => this.call(this.http.get<SessionView>('/api/auth/session'));
  requestCode = (email: string) =>
    this.call(this.http.post<{ message: string }>('/api/auth/code/request', { email }));
  verifyCode = (email: string, code: string) =>
    this.call(this.http.post<{ ok: true }>('/api/auth/code/verify', { email, code }));
  passkeyLoginOptions = () =>
    this.call(
      this.http.post<PublicKeyCredentialRequestOptionsJSON>('/api/auth/passkey/options', {}),
    );
  passkeyLoginVerify = (response: AuthenticationResponseJSON) =>
    this.call(this.http.post<{ ok: true }>('/api/auth/passkey/verify', { response }));
  logout = () => this.call(this.http.post<void>('/api/auth/logout', {}));
  logoutAll = () => this.call(this.http.post<void>('/api/auth/logout-all', {}));

  // Profil und Passkeys
  me = () => this.call(this.http.get<ProfileView>('/api/me'));
  passkeys = () => this.call(this.http.get<PasskeyView[]>('/api/me/passkeys'));
  passkeyRegistrationOptions = () =>
    this.call(
      this.http.post<PublicKeyCredentialCreationOptionsJSON>(
        '/api/me/passkeys/registration/options',
        {},
      ),
    );
  passkeyRegistrationVerify = (response: RegistrationResponseJSON, name: string) =>
    this.call(
      this.http.post<PasskeyView>('/api/me/passkeys/registration/verify', { response, name }),
    );
  renamePasskey = (id: string, name: string) =>
    this.call(this.http.patch<PasskeyView>(`/api/me/passkeys/${id}`, { name }));
  deletePasskey = (id: string) => this.call(this.http.delete<void>(`/api/me/passkeys/${id}`));

  // Mitarbeiter
  employees = () =>
    this.call(this.http.get<(EmployeeView | AdminEmployeeView)[]>('/api/employees'));
  employee = (id: string) => this.call(this.http.get<AdminEmployeeView>(`/api/employees/${id}`));
  createEmployee = (input: EmployeeCreateInput) =>
    this.call(this.http.post<AdminEmployeeView>('/api/employees', input));
  updateEmployee = (id: string, input: EmployeeUpdateInput) =>
    this.call(this.http.patch<AdminEmployeeView>(`/api/employees/${id}`, input));
  lockEmployee = (id: string) =>
    this.call(this.http.post<AdminEmployeeView>(`/api/employees/${id}/lock`, {}));
  unlockEmployee = (id: string) =>
    this.call(this.http.post<AdminEmployeeView>(`/api/employees/${id}/unlock`, {}));
  setCarryOver = (id: string, year: number, days: number) =>
    this.call(
      this.http.put<{ year: number; days: number }>(`/api/employees/${id}/carry-over/${year}`, {
        days,
      }),
    );
  terms = (id: string) => this.call(this.http.get<TermsView[]>(`/api/employees/${id}/terms`));
  createTerms = (id: string, input: TermsInput) =>
    this.call(this.http.post<TermsSaveResult>(`/api/employees/${id}/terms`, input));
  updateTerms = (id: string, termsId: string, input: TermsInput) =>
    this.call(this.http.patch<TermsSaveResult>(`/api/employees/${id}/terms/${termsId}`, input));
  deleteTerms = (id: string, termsId: string) =>
    this.call(this.http.delete<void>(`/api/employees/${id}/terms/${termsId}`));

  // Stammdaten
  legalParameters = () => this.call(this.http.get<LegalParameterView[]>('/api/legal-parameters'));
  holidays = (year: number) =>
    this.call(this.http.get<HolidayView[]>(`/api/holidays?year=${year}`));
  createHoliday = (date: string, name: string) =>
    this.call(this.http.post<HolidayView>('/api/holidays', { date, name }));
  updateHoliday = (id: string, changes: { name?: string; active?: boolean }) =>
    this.call(this.http.patch<HolidayView>(`/api/holidays/${id}`, changes));
  deleteHoliday = (id: string) => this.call(this.http.delete<void>(`/api/holidays/${id}`));
  schoolHolidays = (year: number) =>
    this.call(this.http.get<SchoolHolidayView[]>(`/api/school-holidays?year=${year}`));
  createSchoolHoliday = (input: { name: string; from: LocalDate; to: LocalDate }) =>
    this.call(this.http.post<SchoolHolidayView>('/api/school-holidays', input));
  updateSchoolHoliday = (
    id: string,
    changes: { name?: string; from?: LocalDate; to?: LocalDate; active?: boolean },
  ) => this.call(this.http.patch<SchoolHolidayView>(`/api/school-holidays/${id}`, changes));
  deleteSchoolHoliday = (id: string) =>
    this.call(this.http.delete<void>(`/api/school-holidays/${id}`));
  settings = () => this.call(this.http.get<CompanySettingsView>('/api/settings/company'));
  updateSettings = (assumptionDayIsHoliday: boolean) =>
    this.call(
      this.http.patch<CompanySettingsView>('/api/settings/company', { assumptionDayIsHoliday }),
    );

  // Zeiterfassung (Phase 2)
  today = () => this.call(this.http.get<TodayView>('/api/time/today'));
  clock = (action: 'in' | 'break-start' | 'break-end' | 'out') =>
    this.call(this.http.post<ClockResult>(`/api/time/clock/${action}`, {}));
  week = (week: string, employeeId?: string) =>
    this.call(
      this.http.get<WeekView>('/api/time/week', {
        params: { week, ...(employeeId ? { employeeId } : {}) },
      }),
    );
  month = (month: string, employeeId?: string) =>
    this.call(
      this.http.get<MonthView>('/api/time/month', {
        params: { month, ...(employeeId ? { employeeId } : {}) },
      }),
    );
  teamToday = () => this.call(this.http.get<TeamTodayRow[]>('/api/time/team-today'));
  createEntry = (input: ManualEntryInput) =>
    this.call(this.http.post<EntrySaveResult>('/api/time/entries', input));
  correctEntry = (id: string, input: CorrectionInput) =>
    this.call(this.http.post<CorrectionResult>(`/api/time/entries/${id}/correct`, input));
  voidEntry = (id: string, reason: string) =>
    this.call(this.http.post<CorrectionResult>(`/api/time/entries/${id}/void`, { reason }));
  revisions = (id: string) =>
    this.call(this.http.get<RevisionView[]>(`/api/time/entries/${id}/revisions`));
  corrections = (status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN') =>
    this.call(
      this.http.get<CorrectionRequestView[]>('/api/time/corrections', {
        params: status ? { status } : {},
      }),
    );
  approveCorrection = (id: string) =>
    this.call(this.http.post<CorrectionRequestView>(`/api/time/corrections/${id}/approve`, {}));
  rejectCorrection = (id: string, reason: string) =>
    this.call(
      this.http.post<CorrectionRequestView>(`/api/time/corrections/${id}/reject`, { reason }),
    );
  withdrawCorrection = (id: string) =>
    this.call(this.http.post<CorrectionRequestView>(`/api/time/corrections/${id}/withdraw`, {}));
  monthClosings = () => this.call(this.http.get<MonthClosingView[]>('/api/time/months'));
  closeMonth = (month: string) =>
    this.call(this.http.post<MonthClosingView>(`/api/time/months/${month}/close`, {}));
  reopenMonth = (employeeId: string, month: string) =>
    this.call(
      this.http.post<MonthClosingView>(`/api/time/months/${employeeId}/${month}/reopen`, {}),
    );
  overtime = (employeeId?: string) =>
    this.call(
      this.http.get<OvertimeView | null>('/api/time/overtime', {
        params: employeeId ? { employeeId } : {},
      }),
    );
  setOvertimeAccount = (employeeId: string, since: string | null) =>
    this.call(
      this.http.put<OvertimeView | null>(`/api/employees/${employeeId}/overtime-account`, {
        since,
      }),
    );
  addOvertimeAdjustment = (
    employeeId: string,
    input: { minutes: number; effectiveOn: string; reason: string },
  ) =>
    this.call(
      this.http.post<OvertimeView | null>(
        `/api/employees/${employeeId}/overtime-adjustments`,
        input,
      ),
    );

  // Krankmeldungen (Phase 6)
  sickLeaves = (filter: { employeeId?: string; from?: LocalDate; to?: LocalDate } = {}) =>
    this.call(this.http.get<SickLeaveView[]>('/api/sick', { params: { ...filter } }));
  reportSick = (input: SickLeaveInput) =>
    this.call(this.http.post<SickLeaveView>('/api/sick', input));
  updateSick = (id: string, update: SickLeaveUpdate) =>
    this.call(this.http.patch<SickLeaveView>(`/api/sick/${id}`, update));
  certifySick = (id: string, until: LocalDate | null) =>
    this.call(this.http.put<SickLeaveView>(`/api/sick/${id}/certificate`, { until }));
  deleteSick = (id: string, reason: string) =>
    this.call(this.http.delete<void>(`/api/sick/${id}`, { body: { reason } }));
  sickChecks = () => this.call(this.http.get<SickChecksView>('/api/checks/sick'));
  setCertificateFromDay1 = (employeeId: string, value: boolean) =>
    this.call(
      this.http.patch<{ value: boolean }>(`/api/employees/${employeeId}/certificate-from-day1`, {
        value,
      }),
    );

  // Abwesenheiten (Phase 3)
  leavePreview = (input: LeaveInput) =>
    this.call(this.http.post<LeavePreview>('/api/leave/preview', input));
  createLeave = (input: LeaveInput) =>
    this.call(this.http.post<LeaveRequestView>('/api/leave/requests', input));
  leaveRequests = (filter: { employeeId?: string; status?: LeaveStatus; year?: number } = {}) =>
    this.call(
      this.http.get<LeaveRequestView[]>('/api/leave/requests', {
        params: {
          ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.year ? { year: filter.year } : {}),
        },
      }),
    );
  withdrawLeave = (id: string) =>
    this.call(this.http.post<LeaveRequestView>(`/api/leave/requests/${id}/withdraw`, {}));
  approveLeave = (id: string) =>
    this.call(this.http.post<LeaveRequestView>(`/api/leave/requests/${id}/approve`, {}));
  rejectLeave = (id: string, reason: string) =>
    this.call(this.http.post<LeaveRequestView>(`/api/leave/requests/${id}/reject`, { reason }));
  requestLeaveCancellation = (id: string) =>
    this.call(this.http.post<LeaveRequestView>(`/api/leave/requests/${id}/cancellation`, {}));
  decideLeaveCancellation = (id: string, approve: boolean) =>
    this.call(
      this.http.post<LeaveRequestView>(
        `/api/leave/requests/${id}/cancellation/${approve ? 'approve' : 'reject'}`,
        {},
      ),
    );
  leaveAccount = (year: number, employeeId?: string) =>
    this.call(
      this.http.get<LeaveAccountView>('/api/leave/account', {
        params: { year, ...(employeeId ? { employeeId } : {}) },
      }),
    );
  leaveAccounts = (year: number) =>
    this.call(this.http.get<LeaveAccountView[]>('/api/leave/accounts', { params: { year } }));
  leaveCalendar = (month: string) =>
    this.call(this.http.get<LeaveCalendarView>('/api/leave/calendar', { params: { month } }));
  leaveLedger = (employeeId: string) =>
    this.call(this.http.get<LeaveLedgerView[]>(`/api/employees/${employeeId}/leave-ledger`));
  addLeaveLedger = (employeeId: string, input: LeaveLedgerInput) =>
    this.call(
      this.http.post<LeaveLedgerView[]>(`/api/employees/${employeeId}/leave-ledger`, input),
    );

  // Prüfungen und Nachweise (Phase 4)
  checks = (range: { from?: string; to?: string } = {}) =>
    this.call(
      this.http.get<ChecksView>('/api/checks', {
        params: {
          ...(range.from ? { from: range.from } : {}),
          ...(range.to ? { to: range.to } : {}),
        },
      }),
    );
  leaveNotices = (filter: { employeeId?: string; year?: number } = {}) =>
    this.call(
      this.http.get<LeaveNoticeView[]>('/api/leave/notices', {
        params: {
          ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
          ...(filter.year ? { year: filter.year } : {}),
        },
      }),
    );
  sendLeaveNotices = (year: number, employeeIds?: string[]) =>
    this.call(
      this.http.post<LeaveNoticeView[]>('/api/leave/notices', {
        year,
        ...(employeeIds ? { employeeIds } : {}),
      }),
    );
  readLeaveNotice = (id: string) =>
    this.call(this.http.post<LeaveNoticeView>(`/api/leave/notices/${id}/read`, {}));
  bookForfeiture = (employeeId: string, year: number, kind: ForfeitureKind) =>
    this.call(
      this.http.post<ForfeitureSuggestion>('/api/leave/forfeitures', { employeeId, year, kind }),
    );
  retentionSettings = () =>
    this.call(this.http.get<RetentionSettingsView>('/api/settings/retention'));
  updateRetentionSettings = (input: RetentionSettingsView) =>
    this.call(this.http.put<RetentionSettingsView>('/api/settings/retention', input));
  /** Download-Adressen; der Browser lädt mit dem Sitzungs-Cookie (keine Daten im Speicher der Seite). */
  exportTimeUrl = (month: string, format: 'pdf' | 'csv', employeeId?: string) =>
    `/api/exports/time?${new URLSearchParams({ month, format, ...(employeeId ? { employeeId } : {}) }).toString()}`;
  exportMonthUrl = (month: string) =>
    `/api/exports/month?${new URLSearchParams({ month }).toString()}`;

  // Erinnerungen (Phase 5)
  reminderToday = () => this.call(this.http.get<ReminderTodayView>('/api/reminders/today'));
  muteReminders = () => this.call(this.http.post<void>('/api/reminders/mute', {}));
  pushPublicKey = () =>
    this.call(this.http.get<{ publicKey: string | null }>('/api/push/public-key'));
  pushDevices = () => this.call(this.http.get<PushDeviceView[]>('/api/me/push-subscriptions'));
  addPushDevice = (input: PushSubscriptionInput) =>
    this.call(this.http.post<PushDeviceView[]>('/api/me/push-subscriptions', input));
  removePushDevice = (id: string) =>
    this.call(this.http.delete<void>(`/api/me/push-subscriptions/${id}`));
  testPush = () =>
    this.call(this.http.post<{ delivered: number }>('/api/me/push-subscriptions/test', {}));
  setReminderEmailFallback = (emailFallback: boolean) =>
    this.call(
      this.http.patch<{ emailFallback: boolean }>('/api/me/reminder-settings', { emailFallback }),
    );
  lateEntries = () => this.call(this.http.get<LateEntriesView>('/api/time/late-entries'));
  teamLateEntries = (range: { from?: string; to?: string } = {}) =>
    this.call(
      this.http.get<LateEntriesView>('/api/checks/late-entries', {
        params: {
          ...(range.from ? { from: range.from } : {}),
          ...(range.to ? { to: range.to } : {}),
        },
      }),
    );
  reminderSettings = () =>
    this.call(this.http.get<ReminderSettingsView>('/api/settings/reminders'));
  updateReminderSettings = (input: ReminderSettingsView) =>
    this.call(this.http.put<ReminderSettingsView>('/api/settings/reminders', input));
}
