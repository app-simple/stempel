import type { LocalDate } from '@as/shared';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { IsLocalDate } from '../common/validators';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class SickLeaveInputDto {
  @IsOptional()
  @IsUUID('4', { message: 'Ungültige employeeId.' })
  employeeId?: string;

  @IsIn(['SICK', 'CHILD_SICK'], { message: 'Bitte „krank“ oder „Kind krank“ wählen.' })
  kind!: 'SICK' | 'CHILD_SICK';

  @IsLocalDate()
  from!: LocalDate;

  @IsLocalDate()
  to!: LocalDate;

  @IsOptional()
  @IsBoolean()
  sinceNow?: boolean;
}

export class SickLeaveUpdateDto {
  @ValidateIf((o: SickLeaveUpdateDto) => o.endToday !== true)
  @IsLocalDate()
  to?: LocalDate;

  @IsOptional()
  @IsBoolean()
  endToday?: boolean;
}

export class CertificateDto {
  @ValidateIf((o: CertificateDto) => o.until !== null)
  @IsLocalDate()
  until!: LocalDate | null;
}

export class SickDeleteDto {
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Bitte eine Begründung angeben.' })
  @MaxLength(200)
  reason!: string;
}

export class CertificateFromDay1Dto {
  @IsBoolean()
  value!: boolean;
}
