import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class SendNoticesDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  /** Ohne Angabe: an alle im Jahr Beschäftigten ohne Hinweis für das Jahr. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  employeeIds?: string[];
}

export class ForfeitureDto {
  @IsUUID()
  employeeId!: string;

  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsIn(['YEAR_END', 'MARCH31'])
  kind!: 'YEAR_END' | 'MARCH31';
}

export class RetentionDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(2, { message: 'Mindestens 2 Jahre (§ 16 Abs. 2 ArbZG, § 17 Abs. 1 MiLoG).' })
  @Max(30)
  timeYears!: number;

  @IsInt()
  @Min(2, { message: 'Mindestens 2 Jahre (§ 16 Abs. 2 ArbZG, § 17 Abs. 1 MiLoG).' })
  @Max(30)
  payrollYears!: number;

  @IsInt()
  @Min(2, { message: 'Mindestens 2 Jahre.' })
  @Max(30)
  leaveYears!: number;

  @IsInt()
  @Min(2, { message: 'Mindestens 2 Jahre.' })
  @Max(30)
  auditYears!: number;
}
