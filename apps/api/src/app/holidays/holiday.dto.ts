import type { LocalDate } from '@as/shared';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { IsLocalDate } from '../common/validators';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateHolidayDto {
  @IsLocalDate()
  date!: LocalDate;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Bitte einen Namen angeben.' })
  @MaxLength(80)
  name!: string;
}

export class UpdateHolidayDto {
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Bitte einen Namen angeben.' })
  @MaxLength(80)
  name?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;
}

export class UpdateSettingsDto {
  @IsBoolean()
  assumptionDayIsHoliday!: boolean;
}
