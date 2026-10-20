import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { LocalDate, SchoolHolidayView } from '@as/shared';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Prisma, type SchoolHoliday } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { fromLocalDate, toLocalDate } from '../common/dates';
import { CurrentUser, Roles } from '../common/decorators';
import { IsLocalDate } from '../common/validators';
import { PrismaService } from '../prisma/prisma.service';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateSchoolHolidayDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Bitte einen Namen angeben.' })
  @MaxLength(80)
  name!: string;

  @IsLocalDate()
  from!: LocalDate;

  @IsLocalDate()
  to!: LocalDate;
}

export class UpdateSchoolHolidayDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Bitte einen Namen angeben.' })
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsLocalDate()
  from?: LocalDate;

  @IsOptional()
  @IsLocalDate()
  to?: LocalDate;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/**
 * Schulferien für den Jugendarbeitsschutz (Spezifikation Phase 7, Abschnitt 3): ohne personenbezogene
 * Daten, für alle Angemeldeten lesbar, nur der Admin pflegt sie.
 */
@Injectable()
export class SchoolHolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(year: number): Promise<SchoolHolidayView[]> {
    const rows = await this.prisma.schoolHoliday.findMany({
      where: {
        from: { lte: fromLocalDate(`${year}-12-31`) },
        to: { gte: fromLocalDate(`${year}-01-01`) },
      },
      orderBy: { from: 'asc' },
    });
    return rows.map(toView);
  }

  async create(admin: AuthUser, input: CreateSchoolHolidayDto): Promise<SchoolHolidayView> {
    assertRange(input.from, input.to);
    const row = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.schoolHoliday.create({
          data: { name: input.name, from: fromLocalDate(input.from), to: fromLocalDate(input.to) },
        });
        await this.audit.record(
          {
            action: 'school-holiday.create',
            actorId: admin.id,
            entityType: 'SchoolHoliday',
            entityId: created.id,
            details: { from: input.from, to: input.to },
          },
          tx,
        );
        return created;
      })
      .catch(rethrowDuplicate);
    return toView(row);
  }

  async update(
    admin: AuthUser,
    id: string,
    input: UpdateSchoolHolidayDto,
  ): Promise<SchoolHolidayView> {
    const existing = await this.prisma.schoolHoliday.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Schulferien nicht gefunden.');
    const from = input.from ?? toLocalDate(existing.from);
    const to = input.to ?? toLocalDate(existing.to);
    assertRange(from, to);
    const row = await this.prisma
      .$transaction(async (tx) => {
        const updated = await tx.schoolHoliday.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
            from: fromLocalDate(from),
            to: fromLocalDate(to),
          },
        });
        await this.audit.record(
          {
            action: 'school-holiday.update',
            actorId: admin.id,
            entityType: 'SchoolHoliday',
            entityId: id,
            details: { fields: Object.keys(input).sort() },
          },
          tx,
        );
        return updated;
      })
      .catch(rethrowDuplicate);
    return toView(row);
  }

  async remove(admin: AuthUser, id: string): Promise<void> {
    const existing = await this.prisma.schoolHoliday.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Schulferien nicht gefunden.');
    await this.prisma.$transaction(async (tx) => {
      await tx.schoolHoliday.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'school-holiday.delete',
          actorId: admin.id,
          entityType: 'SchoolHoliday',
          entityId: id,
        },
        tx,
      );
    });
  }
}

@Controller('school-holidays')
export class SchoolHolidaysController {
  constructor(private readonly schoolHolidays: SchoolHolidaysService) {}

  @Get()
  list(@Query('year', ParseIntPipe) year: number): Promise<SchoolHolidayView[]> {
    return this.schoolHolidays.list(year);
  }

  @Post()
  @Roles('ADMIN')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSchoolHolidayDto,
  ): Promise<SchoolHolidayView> {
    return this.schoolHolidays.create(user, dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateSchoolHolidayDto,
  ): Promise<SchoolHolidayView> {
    return this.schoolHolidays.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles('ADMIN')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.schoolHolidays.remove(user, id);
  }
}

function assertRange(from: LocalDate, to: LocalDate): void {
  if (to < from) throw new BadRequestException('Das Ende der Ferien liegt vor dem Beginn.');
}

function toView(row: SchoolHoliday): SchoolHolidayView {
  return {
    id: row.id,
    name: row.name,
    from: toLocalDate(row.from),
    to: toLocalDate(row.to),
    active: row.active,
  };
}

function rethrowDuplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ConflictException('Diese Schulferien sind schon angelegt.');
  }
  throw error;
}
