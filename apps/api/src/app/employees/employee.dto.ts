import {
  EMPLOYMENT_TYPES,
  ROLES,
  type EmploymentType,
  type IsoWeekday,
  type LocalDate,
  type Role,
} from '@as/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsLocalDate } from '../common/validators';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const emptyToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === ''
    ? null
    : typeof value === 'string'
      ? value.trim()
      : value;

export class TermsDto {
  @IsLocalDate()
  validFrom!: LocalDate;

  @IsIn(EMPLOYMENT_TYPES, { message: 'Bitte eine Beschäftigungsart wählen.' })
  type!: EmploymentType;

  @IsInt({ message: 'Die Wochenarbeitszeit muss in ganzen Minuten angegeben werden.' })
  @Min(0)
  @Max(7 * 24 * 60)
  weeklyMinutes!: number;

  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  workDays!: IsoWeekday[];

  @IsInt({ message: 'Urlaubstage müssen ganze Zahlen sein.' })
  @Min(0)
  @Max(365)
  annualLeaveDays!: number;

  @IsInt({ message: 'Urlaubstage müssen ganze Zahlen sein.' })
  @Min(0)
  @Max(365)
  extraLeaveDays!: number;

  @ValidateIf((_, value) => value !== null)
  @IsInt({ message: 'Der Stundenlohn muss in Cent angegeben werden.' })
  @Min(0)
  @Max(100_000)
  hourlyWageCents!: number | null;
}

export class CreateEmployeeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Name fehlt.' })
  @MaxLength(120)
  name!: string;

  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(120)
  jobTitle!: string | null;

  @IsIn(ROLES, { message: 'Bitte eine Rolle wählen.' })
  role!: Role;

  @Transform(trim)
  @IsEmail({}, { message: 'Bitte eine gültige Anmeldeadresse eingeben.' })
  @MaxLength(254)
  loginEmail!: string;

  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  leadId!: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  deputyId!: string | null;

  @IsLocalDate()
  entryDate!: LocalDate;

  @ValidateIf((_, value) => value !== null)
  @IsLocalDate()
  exitDate!: LocalDate | null;

  @IsDefined({ message: 'Der Vertragsstand fehlt.' })
  @IsObject()
  @ValidateNested()
  @Type(() => TermsDto)
  terms!: TermsDto;

  @IsInt()
  @Min(0, { message: 'Der Übertrag liegt zwischen 0 und 60 Tagen.' })
  @Max(60, { message: 'Der Übertrag liegt zwischen 0 und 60 Tagen.' })
  carryOverDays!: number;
  /** Jugendarbeitsschutz (Phase 7): nur Admin. */
  @IsOptional()
  @ValidateIf((o: { birthDate?: unknown }) => o.birthDate !== null)
  @IsLocalDate()
  birthDate?: LocalDate | null;

  @IsOptional()
  @ValidateIf((o: { fullTimeSchoolUntil?: unknown }) => o.fullTimeSchoolUntil !== null)
  @IsLocalDate()
  fullTimeSchoolUntil?: LocalDate | null;
}

export class UpdateEmployeeDto {
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Name fehlt.' })
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(120)
  jobTitle?: string | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(ROLES, { message: 'Bitte eine Rolle wählen.' })
  role?: Role;

  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsEmail({}, { message: 'Bitte eine gültige Anmeldeadresse eingeben.' })
  @MaxLength(254)
  loginEmail?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  leadId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  deputyId?: string | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsLocalDate()
  entryDate?: LocalDate;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsLocalDate()
  exitDate?: LocalDate | null;
  /** Jugendarbeitsschutz (Phase 7): nur Admin. */
  @IsOptional()
  @ValidateIf((o: { birthDate?: unknown }) => o.birthDate !== null)
  @IsLocalDate()
  birthDate?: LocalDate | null;

  @IsOptional()
  @ValidateIf((o: { fullTimeSchoolUntil?: unknown }) => o.fullTimeSchoolUntil !== null)
  @IsLocalDate()
  fullTimeSchoolUntil?: LocalDate | null;
}

export class CarryOverDto {
  @IsInt()
  @Min(0, { message: 'Der Übertrag liegt zwischen 0 und 60 Tagen.' })
  @Max(60, { message: 'Der Übertrag liegt zwischen 0 und 60 Tagen.' })
  days!: number;
}
