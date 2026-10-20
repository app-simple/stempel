import { ABSENCE_TYPES, type AbsenceType, type LocalDate } from '@as/shared';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
  ValidateIf,
} from 'class-validator';
import { IsLocalDate } from '../common/validators';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const emptyToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || null : value;

export class LeaveInputDto {
  @IsIn(ABSENCE_TYPES, { message: 'Bitte eine gültige Art wählen.' })
  type!: AbsenceType;

  @IsLocalDate()
  from!: LocalDate;

  @IsLocalDate()
  to!: LocalDate;

  @IsBoolean()
  startHalf!: boolean;

  @IsBoolean()
  endHalf!: boolean;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(140, { message: 'Die Notiz darf höchstens 140 Zeichen haben.' })
  note?: string | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  employeeId?: string;
}

export class LeaveRejectDto {
  @Transform(trim)
  @IsString()
  @MinLength(10, { message: 'Bitte den betrieblichen Grund nennen (mindestens ein Satz).' })
  @MaxLength(500)
  reason!: string;
}

export class LeaveLedgerDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsInt()
  @NotEquals(0, { message: 'Die Korrektur darf nicht 0 Tage betragen.' })
  @Min(-200)
  @Max(200)
  halfDays!: number;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Bitte einen Vermerk angeben.' })
  @MaxLength(200)
  note!: string;
}
