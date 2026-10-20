import type { LocalDate } from '@as/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  NotEquals,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsLocalDate, IsTimeOfDay } from '../common/validators';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class BreakDto {
  @IsTimeOfDay()
  start!: string;

  @IsTimeOfDay()
  end!: string;
}

class SpanDto {
  @IsTimeOfDay()
  start!: string;

  @ValidateIf((_, value) => value !== null)
  @IsTimeOfDay()
  end!: string | null;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BreakDto)
  breaks!: BreakDto[];

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Bitte eine Begründung angeben.' })
  @MaxLength(500)
  reason!: string;
}

export class ManualEntryDto extends SpanDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  employeeId?: string;

  @IsLocalDate()
  date!: LocalDate;
}

export class CorrectionDto extends SpanDto {}

export class ReasonDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Bitte eine Begründung angeben.' })
  @MaxLength(500)
  reason!: string;
}

export class OvertimeAccountDto {
  @ValidateIf((_, value) => value !== null)
  @IsLocalDate()
  since!: LocalDate | null;
}

export class OvertimeAdjustmentDto {
  @IsInt()
  @NotEquals(0, { message: 'Die Korrektur darf nicht 0 Minuten betragen.' })
  @Min(-100_000)
  @Max(100_000)
  minutes!: number;

  @IsLocalDate()
  effectiveOn!: LocalDate;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Bitte eine Begründung angeben.' })
  @MaxLength(500)
  reason!: string;
}
