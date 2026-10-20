import { ageOn } from '@as/time-rules';
import { reconcileAffectedSickCredits } from '../sick/sick-credit';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { formatLocalDate } from '@as/shared';
import type {
  AdminEmployeeView,
  EmployeeView,
  LocalDate,
  ProfileView,
  Role,
  TermsInput,
  TermsSaveResult,
  TermsView,
} from '@as/shared';
import { Prisma } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient;

/** Schlüssel der Advisory-Lock, die alle schreibenden Admin-Operationen auf Mitarbeiter serialisiert. */
const EMPLOYEE_ADMIN_LOCK = 7_310_001;
import { employeeScope, scopedEmployee } from '../access/employee-scope';
import { representedIds } from '../access/deputy';
import { lockEmployeeTime } from '../time/time-context';
import { AuditService } from '../audit/audit.service';
import { canLogIn } from '../auth/login-eligibility';
import type { AuthUser } from '../common/auth-user';
import { Clock } from '../common/clock';
import { fromLocalDate, toLocalDate } from '../common/dates';
import { loadLegalValues } from '../legal/legal-values';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateEmployeeDto, UpdateEmployeeDto } from './employee.dto';
import {
  employeeInclude,
  toAdminEmployeeView,
  toOwnEmployeeView,
  toEmployeeView,
  toTermsView,
  type LegalContext,
} from './employee-view';
import { TermsValidationService } from './terms-validation.service';

const LEAD_ROLES: Role[] = ['LEAD', 'ADMIN'];

/** Mitarbeiterverwaltung nach Spezifikation Phase 1, Abschnitt 8. Schreibende Methoden nur für den Admin. */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly termsValidation: TermsValidationService,
  ) {}

  /**
   * Alle schreibenden Operationen laufen nacheinander: Prüfungen (letzter Admin, Kreise, Mindestbestand
   * an Vertragsständen) und Schreiben sehen denselben, frischen Stand (Codex-Review AP6/7, Befunde 1, 2, 4, 5).
   */
  private locked<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${EMPLOYEE_ADMIN_LOCK})`;
      return work(tx);
    });
  }

  private today(): LocalDate {
    return this.clock.today();
  }

  private year(): number {
    return Number(this.today().slice(0, 4));
  }

  private legalToday(): Promise<LegalContext> {
    return loadLegalValues(this.prisma, this.today());
  }

  async list(user: AuthUser): Promise<EmployeeView[] | AdminEmployeeView[]> {
    const rows = await this.prisma.employee.findMany({
      where: employeeScope(user),
      include: employeeInclude(this.year()),
      orderBy: { name: 'asc' },
    });
    const legal = await this.legalToday();
    const map = user.role === 'ADMIN' ? toAdminEmployeeView : toEmployeeView;
    return rows.map((row) => map(row, this.today(), legal));
  }

  async get(user: AuthUser, id: string): Promise<EmployeeView | AdminEmployeeView> {
    const row = await this.prisma.employee.findFirst({
      where: scopedEmployee(user, id),
      include: employeeInclude(this.year()),
    });
    if (!row) throw new NotFoundException('Mitarbeiter nicht gefunden.');
    const legal = await this.legalToday();
    return user.role === 'ADMIN'
      ? toAdminEmployeeView(row, this.today(), legal)
      : toEmployeeView(row, this.today(), legal);
  }

  /** Eigenes Profil inklusive der eigenen Anmeldeadresse (Entscheidung 2, nur lesend). */
  async profile(user: AuthUser): Promise<ProfileView> {
    const row = await this.prisma.employee.findUniqueOrThrow({
      where: { id: user.id },
      include: { ...employeeInclude(this.year()), _count: { select: { passkeys: true } } },
    });
    return {
      ...toOwnEmployeeView(row, this.today(), await this.legalToday()),
      passkeyCount: row._count.passkeys,
      representing: (await representedIds(this.prisma, user.id, this.today())).size,
      reminderEmailFallback: row.reminderEmailFallback,
    };
  }

  /**
   * Geburtsdatum (Phase 7): nicht in der Zukunft; beim Eintritt mindestens 15 Jahre (§ 5 Abs. 1
   * JArbSchG, Beschäftigung von Kindern verboten).
   */
  private assertBirthDate(birthDate: LocalDate | null, entryDate: LocalDate): void {
    if (!birthDate) return;
    if (birthDate > this.today())
      throw new BadRequestException('Das Geburtsdatum liegt in der Zukunft.');
    if (ageOn(birthDate, entryDate) < 15)
      throw new BadRequestException(
        'Personen unter 15 Jahren dürfen nicht beschäftigt werden (§ 5 Abs. 1 JArbSchG).',
      );
  }

  private async birthDateOf(id: string): Promise<LocalDate | null> {
    const row = await this.prisma.employee.findUnique({
      where: { id },
      select: { birthDate: true },
    });
    return row?.birthDate ? toLocalDate(row.birthDate) : null;
  }

  async create(admin: AuthUser, dto: CreateEmployeeDto): Promise<AdminEmployeeView> {
    const loginEmail = dto.loginEmail.toLowerCase();
    assertDates(dto.entryDate, dto.exitDate);
    this.assertBirthDate(dto.birthDate ?? null, dto.entryDate);
    await this.assertFirstTermsStart(dto.entryDate, dto.terms.validFrom);
    await this.termsValidation.validate(dto.terms, dto.birthDate ?? null);

    const id = await this.locked(async (tx) => {
      await assertEmailFree(tx, loginEmail);
      await assertLeadAndDeputy(tx, null, dto.role, dto.leadId, dto.deputyId);
      const employee = await tx.employee.create({
        data: {
          name: dto.name,
          jobTitle: dto.jobTitle,
          role: dto.role,
          loginEmail,
          leadId: dto.leadId,
          deputyId: dto.deputyId,
          entryDate: fromLocalDate(dto.entryDate),
          exitDate: dto.exitDate ? fromLocalDate(dto.exitDate) : null,
          birthDate: dto.birthDate ? fromLocalDate(dto.birthDate) : null,
          fullTimeSchoolUntil: dto.fullTimeSchoolUntil
            ? fromLocalDate(dto.fullTimeSchoolUntil)
            : null,
        },
      });
      const terms = await tx.employmentTerms.create({
        data: { ...termsData(dto.terms), employeeId: employee.id, createdById: admin.id },
      });
      if (dto.carryOverDays > 0) {
        await tx.leaveCarryOver.create({
          data: {
            employeeId: employee.id,
            year: this.year(),
            days: dto.carryOverDays,
            updatedById: admin.id,
          },
        });
      }
      await this.audit.record(
        {
          action: 'employee.create',
          actorId: admin.id,
          entityType: 'Employee',
          entityId: employee.id,
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'terms.create',
          actorId: admin.id,
          entityType: 'EmploymentTerms',
          entityId: terms.id,
          details: { employeeId: employee.id },
        },
        tx,
      );
      return employee.id;
    }).catch(rethrowUniqueEmail);
    return this.get(admin, id) as Promise<AdminEmployeeView>;
  }

  /** Schreibt nur die übergebenen Felder; geprüft wird gegen den frischen Stand unter Sperre. */
  async update(admin: AuthUser, id: string, dto: UpdateEmployeeDto): Promise<AdminEmployeeView> {
    await this.locked(async (tx) => {
      const existing = await tx.employee.findUnique({
        where: { id },
        include: {
          terms: { orderBy: { validFrom: 'asc' }, take: 1 },
          _count: { select: { reports: true, deputyFor: true } },
        },
      });
      if (!existing) throw new NotFoundException('Mitarbeiter nicht gefunden.');

      const role = dto.role ?? (existing.role as Role);
      const leadId = dto.leadId !== undefined ? dto.leadId : existing.leadId;
      const deputyId = dto.deputyId !== undefined ? dto.deputyId : existing.deputyId;
      const entryDate = dto.entryDate ?? toLocalDate(existing.entryDate);
      const exitDate =
        dto.exitDate !== undefined
          ? dto.exitDate
          : existing.exitDate
            ? toLocalDate(existing.exitDate)
            : null;
      const loginEmail = dto.loginEmail?.toLowerCase();

      // Zuerst: Es muss ein anmeldefähiger Admin bleiben.
      const staysAdmin =
        role === 'ADMIN' &&
        canLogIn(
          { lockedAt: existing.lockedAt, exitDate: exitDate ? fromLocalDate(exitDate) : null },
          this.today(),
        );
      if (existing.role === 'ADMIN' && !staysAdmin) await assertAnotherAdmin(tx, id, this.today());

      if (loginEmail && loginEmail !== existing.loginEmail) await assertEmailFree(tx, loginEmail);
      await assertLeadAndDeputy(tx, id, role, leadId, deputyId);
      assertDates(entryDate, exitDate);
      const birthDate =
        dto.birthDate !== undefined
          ? dto.birthDate
          : existing.birthDate
            ? toLocalDate(existing.birthDate)
            : null;
      this.assertBirthDate(birthDate, entryDate);
      const firstTerms = existing.terms[0];
      if (firstTerms && entryDate > toLocalDate(firstTerms.validFrom)) {
        throw new BadRequestException(
          'Der Eintritt darf nicht nach dem ersten Vertragsstand liegen.',
        );
      }
      if (
        role === 'EMPLOYEE' &&
        existing.role !== 'EMPLOYEE' &&
        existing._count.reports + existing._count.deputyFor > 0
      ) {
        throw new ConflictException(
          'Diese Person ist noch Vorgesetzte/r oder Vertretung für andere Mitarbeiter.',
        );
      }

      const data: Prisma.EmployeeUncheckedUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.jobTitle !== undefined) data.jobTitle = dto.jobTitle;
      if (loginEmail !== undefined) data.loginEmail = loginEmail;
      if (dto.role !== undefined) data.role = dto.role;
      if (dto.leadId !== undefined) data.leadId = dto.leadId;
      if (dto.deputyId !== undefined) data.deputyId = dto.deputyId;
      if (dto.entryDate !== undefined) data.entryDate = fromLocalDate(dto.entryDate);
      if (dto.exitDate !== undefined)
        data.exitDate = dto.exitDate ? fromLocalDate(dto.exitDate) : null;
      if (dto.birthDate !== undefined)
        data.birthDate = dto.birthDate ? fromLocalDate(dto.birthDate) : null;
      if (dto.fullTimeSchoolUntil !== undefined)
        data.fullTimeSchoolUntil = dto.fullTimeSchoolUntil
          ? fromLocalDate(dto.fullTimeSchoolUntil)
          : null;
      await tx.employee.update({ where: { id }, data });
      // Nur Feldnamen, keine Werte: die Anmeldeadresse gehört nicht ins Protokoll.
      await this.audit.record(
        {
          action: 'employee.update',
          actorId: admin.id,
          entityType: 'Employee',
          entityId: id,
          details: { fields: Object.keys(data).sort() },
        },
        tx,
      );
    }).catch(rethrowUniqueEmail);
    return this.get(admin, id) as Promise<AdminEmployeeView>;
  }

  /** Manuelle Sperre: beendet alle Sitzungen der Person. */
  async lock(admin: AuthUser, id: string): Promise<AdminEmployeeView> {
    await this.locked(async (tx) => {
      const existing = await tx.employee.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Mitarbeiter nicht gefunden.');
      if (existing.role === 'ADMIN') await assertAnotherAdmin(tx, id, this.today());
      await tx.employee.update({
        where: { id },
        data: { lockedAt: existing.lockedAt ?? this.clock.now() },
      });
      const { count } = await tx.session.deleteMany({ where: { employeeId: id } });
      await this.audit.record(
        {
          action: 'employee.lock',
          actorId: admin.id,
          entityType: 'Employee',
          entityId: id,
          details: { sessions: count },
        },
        tx,
      );
    });
    return this.get(admin, id) as Promise<AdminEmployeeView>;
  }

  /** Hebt nur die manuelle Sperre auf; nach dem Austritt bleibt die Anmeldung gesperrt. */
  async unlock(admin: AuthUser, id: string): Promise<AdminEmployeeView> {
    await this.locked(async (tx) => {
      const existing = await tx.employee.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Mitarbeiter nicht gefunden.');
      await tx.employee.update({ where: { id }, data: { lockedAt: null } });
      await this.audit.record(
        { action: 'employee.unlock', actorId: admin.id, entityType: 'Employee', entityId: id },
        tx,
      );
    });
    return this.get(admin, id) as Promise<AdminEmployeeView>;
  }

  async listTerms(user: AuthUser, id: string): Promise<TermsView[]> {
    const employee = await this.prisma.employee.findFirst({
      where: scopedEmployee(user, id),
      include: { terms: { orderBy: { validFrom: 'asc' } } },
    });
    if (!employee) throw new NotFoundException('Mitarbeiter nicht gefunden.');
    return employee.terms.map((t) => toTermsView(t, this.today()));
  }

  /** Neuer Vertragsstand mit Stichtag; Korrekturen geltender Stände laufen ebenfalls über einen neuen Stand. */
  async createTerms(admin: AuthUser, id: string, input: TermsInput): Promise<TermsSaveResult> {
    const validation = await this.termsValidation.validate(input, await this.birthDateOf(id));
    const terms = await this.locked(async (tx) => {
      const employee = await tx.employee.findUnique({
        where: { id },
        include: { terms: { orderBy: { validFrom: 'asc' }, take: 1 } },
      });
      if (!employee) throw new NotFoundException('Mitarbeiter nicht gefunden.');
      const first = employee.terms[0];
      if (
        input.validFrom < toLocalDate(employee.entryDate) ||
        (first && input.validFrom < toLocalDate(first.validFrom))
      ) {
        throw new BadRequestException(
          'Ein Vertragsstand gilt frühestens ab dem ersten Vertragsstand und dem Eintritt.',
        );
      }
      const created = await tx.employmentTerms.create({
        data: { ...termsData(input), employeeId: id, createdById: admin.id },
      });
      await this.audit.record(
        {
          action: 'terms.create',
          actorId: admin.id,
          entityType: 'EmploymentTerms',
          entityId: created.id,
          details: { employeeId: id },
        },
        tx,
      );
      return created;
    }).catch(rethrowUniqueTerms);
    await reconcileAffectedSickCredits(this.prisma, { employeeId: id }, admin.id);
    return {
      terms: toTermsView(terms, this.today()),
      warnings: validation.warnings,
      infos: validation.infos,
    };
  }

  /** Nur künftige Stände sind änderbar (Entscheidung 5); der erste Stand behält seinen Stichtag. */
  async updateTerms(
    admin: AuthUser,
    id: string,
    termsId: string,
    input: TermsInput,
  ): Promise<TermsSaveResult> {
    if (input.validFrom <= this.today()) {
      throw new BadRequestException(
        'Ein geänderter künftiger Stand muss weiterhin in der Zukunft beginnen.',
      );
    }
    const validation = await this.termsValidation.validate(input, await this.birthDateOf(id));
    const terms = await this.locked(async (tx) => {
      const { existing, isFirst } = await this.futureTerms(tx, id, termsId);
      if (isFirst && toLocalDate(existing.validFrom) !== input.validFrom) {
        throw new BadRequestException(
          'Der Stichtag des ersten Vertragsstands lässt sich nicht verschieben.',
        );
      }
      const updated = await tx.employmentTerms.update({
        where: { id: existing.id },
        data: termsData(input),
      });
      await this.audit.record(
        {
          action: 'terms.update',
          actorId: admin.id,
          entityType: 'EmploymentTerms',
          entityId: existing.id,
          details: { employeeId: id },
        },
        tx,
      );
      return updated;
    }).catch(rethrowUniqueTerms);
    await reconcileAffectedSickCredits(this.prisma, { employeeId: id }, admin.id);
    return {
      terms: toTermsView(terms, this.today()),
      warnings: validation.warnings,
      infos: validation.infos,
    };
  }

  /** Nur künftige Stände; der erste Stand bleibt immer bestehen, damit ab Eintritt ein Stand gilt. */
  async deleteTerms(admin: AuthUser, id: string, termsId: string): Promise<void> {
    await this.locked(async (tx) => {
      const { existing, isFirst } = await this.futureTerms(tx, id, termsId);
      if (isFirst) throw new ConflictException('Der erste Vertragsstand lässt sich nicht löschen.');
      await tx.employmentTerms.delete({ where: { id: existing.id } });
      await this.audit.record(
        {
          action: 'terms.delete',
          actorId: admin.id,
          entityType: 'EmploymentTerms',
          entityId: existing.id,
          details: { employeeId: id },
        },
        tx,
      );
    });
    await reconcileAffectedSickCredits(this.prisma, { employeeId: id }, admin.id);
  }

  async setCarryOver(
    admin: AuthUser,
    id: string,
    year: number,
    days: number,
  ): Promise<{ year: number; days: number }> {
    const current = this.year();
    if (year < current - 1 || year > current + 1) {
      throw new BadRequestException(
        'Ein Übertrag lässt sich nur für das Vorjahr, das laufende oder das nächste Jahr pflegen.',
      );
    }
    await this.locked(async (tx) => {
      // Gleiche Personensperre wie Anträge und Verfall (Codex-Review Phase 4 API, Befund 5).
      await lockEmployeeTime(tx, id);
      const employee = await tx.employee.findUnique({ where: { id } });
      if (!employee) throw new NotFoundException('Mitarbeiter nicht gefunden.');
      const row = await tx.leaveCarryOver.upsert({
        where: { employeeId_year: { employeeId: id, year } },
        create: { employeeId: id, year, days, updatedById: admin.id },
        update: { days, updatedById: admin.id },
      });
      await this.audit.record(
        {
          action: 'carry-over.set',
          actorId: admin.id,
          entityType: 'LeaveCarryOver',
          entityId: row.id,
          details: { employeeId: id, year, days },
        },
        tx,
      );
    });
    return { year, days };
  }

  /**
   * Erster Vertragsstand gilt ab Eintritt (Spezifikation Abschnitt 8). Liegt der Eintritt vor dem ersten
   * Stichtag gesetzlicher Werte, gilt er ab diesem Stichtag (Rückfrage an den Auftraggeber offen).
   */
  private async assertFirstTermsStart(entryDate: LocalDate, validFrom: LocalDate): Promise<void> {
    const legalStart = await this.termsValidation.earliestLegalDate();
    const required = legalStart && entryDate < legalStart ? legalStart : entryDate;
    if (validFrom !== required) {
      throw new BadRequestException(
        required === entryDate
          ? `Der erste Vertragsstand gilt ab dem Eintritt (${formatLocalDate(entryDate)}).`
          : `Der erste Vertragsstand gilt ab ${formatLocalDate(required)}, weil für frühere Stichtage keine gesetzlichen Werte hinterlegt sind.`,
      );
    }
  }

  /** Lädt einen Stand unter Sperre und prüft die Änderbarkeit zum Zeitpunkt des Schreibens. */
  private async futureTerms(tx: Tx, id: string, termsId: string) {
    const all = await tx.employmentTerms.findMany({
      where: { employeeId: id },
      orderBy: { validFrom: 'asc' },
    });
    const existing = all.find((t) => t.id === termsId);
    if (!existing) throw new NotFoundException('Vertragsstand nicht gefunden.');
    if (toLocalDate(existing.validFrom) <= this.today()) {
      throw new ConflictException(
        'Geltende oder vergangene Vertragsstände sind unveränderlich. Bitte einen neuen Stand anlegen.',
      );
    }
    return { existing, isFirst: all[0]?.id === existing.id };
  }
}

async function assertEmailFree(tx: Tx, loginEmail: string): Promise<void> {
  const taken = await tx.employee.findUnique({ where: { loginEmail }, select: { id: true } });
  if (taken) throw new ConflictException('Diese Anmeldeadresse ist bereits vergeben.');
}

/** Vorgesetzte/r ist Pflicht für Mitarbeiter und Vorgesetzte; beide Rollen verweisen auf LEAD oder ADMIN. */
async function assertLeadAndDeputy(
  tx: Tx,
  selfId: string | null,
  role: Role,
  leadId: string | null,
  deputyId: string | null,
): Promise<void> {
  if (role !== 'ADMIN' && !leadId)
    throw new BadRequestException('Bitte eine/n Vorgesetzte/n wählen.');
  if (leadId && leadId === selfId)
    throw new BadRequestException('Niemand kann sich selbst vorgesetzt sein.');
  if (deputyId && deputyId === selfId)
    throw new BadRequestException('Niemand kann sich selbst vertreten.');
  if (deputyId && deputyId === leadId)
    throw new BadRequestException(
      'Die Vertretung muss eine andere Person als der/die Vorgesetzte sein.',
    );

  for (const [refId, label] of [
    [leadId, 'Vorgesetzte/r'],
    [deputyId, 'Vertretung'],
  ] as const) {
    if (!refId) continue;
    const ref = await tx.employee.findUnique({ where: { id: refId }, select: { role: true } });
    if (!ref || !LEAD_ROLES.includes(ref.role as Role)) {
      throw new BadRequestException(`${label} muss die Rolle Vorgesetzte/r oder Admin haben.`);
    }
  }

  // Keine Kreise in der Kette der Vorgesetzten.
  if (selfId && leadId) {
    let cursor: string | null = leadId;
    for (let depth = 0; cursor && depth < 100; depth++) {
      if (cursor === selfId)
        throw new BadRequestException('Die Zuordnung der Vorgesetzten darf keinen Kreis bilden.');
      const next: { leadId: string | null } | null = await tx.employee.findUnique({
        where: { id: cursor },
        select: { leadId: true },
      });
      cursor = next?.leadId ?? null;
    }
  }
}

/** Es muss immer ein anmeldefähiger Admin bleiben. */
async function assertAnotherAdmin(tx: Tx, excludeId: string, today: LocalDate): Promise<void> {
  const admins = await tx.employee.findMany({
    where: { role: 'ADMIN', id: { not: excludeId } },
    select: { lockedAt: true, exitDate: true },
  });
  if (!admins.some((a) => canLogIn(a, today))) {
    throw new ConflictException('Es muss mindestens ein anmeldefähiger Admin bleiben.');
  }
}

function termsData(input: TermsInput) {
  return {
    validFrom: fromLocalDate(input.validFrom),
    type: input.type,
    weeklyMinutes: input.weeklyMinutes,
    workDays: [...new Set(input.workDays)].sort((a, b) => a - b),
    annualLeaveDays: input.annualLeaveDays,
    extraLeaveDays: input.extraLeaveDays,
    hourlyWageCents: input.hourlyWageCents,
  };
}

function assertDates(entryDate: LocalDate, exitDate: LocalDate | null): void {
  if (exitDate && exitDate < entryDate)
    throw new BadRequestException('Der Austritt liegt vor dem Eintritt.');
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function rethrowUniqueEmail(error: unknown): never {
  if (isUniqueViolation(error))
    throw new ConflictException('Diese Anmeldeadresse ist bereits vergeben.');
  throw error;
}

function rethrowUniqueTerms(error: unknown): never {
  if (isUniqueViolation(error))
    throw new ConflictException('Für diesen Stichtag gibt es schon einen Vertragsstand.');
  throw error;
}
