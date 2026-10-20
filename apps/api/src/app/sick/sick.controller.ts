import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { isLocalDate, type LocalDate, type SickChecksView, type SickLeaveView } from '@as/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import {
  CertificateDto,
  CertificateFromDay1Dto,
  SickDeleteDto,
  SickLeaveInputDto,
  SickLeaveUpdateDto,
} from './sick.dto';
import { SickService } from './sick.service';

const uuid = new ParseUUIDPipe();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optional(value: string | undefined, check: (v: string) => boolean, name: string) {
  if (value !== undefined && !check(value))
    throw new BadRequestException(`Ungültige Angabe: ${name}.`);
  return value;
}

/** Krankmeldungen (Spezifikation Phase 6). Rechte prüft der Service je Person. */
@Controller()
export class SickController {
  constructor(private readonly sick: SickService) {}

  @Get('sick')
  list(
    @CurrentUser() user: AuthUser,
    @Query('employeeId') employeeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<SickLeaveView[]> {
    return this.sick.list(user, {
      employeeId: optional(employeeId, (v) => UUID.test(v), 'employeeId'),
      from: optional(from, isLocalDate, 'from') as LocalDate | undefined,
      to: optional(to, isLocalDate, 'to') as LocalDate | undefined,
    });
  }

  @Get('checks/sick')
  @Roles('LEAD', 'ADMIN')
  checks(@CurrentUser() user: AuthUser): Promise<SickChecksView> {
    return this.sick.checks(user);
  }

  @Post('sick')
  create(@CurrentUser() user: AuthUser, @Body() dto: SickLeaveInputDto): Promise<SickLeaveView> {
    return this.sick.create(user, dto);
  }

  @Patch('sick/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: SickLeaveUpdateDto,
  ): Promise<SickLeaveView> {
    return this.sick.update(user, id, dto);
  }

  @Put('sick/:id/certificate')
  certify(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: CertificateDto,
  ): Promise<SickLeaveView> {
    return this.sick.certify(user, id, dto.until);
  }

  @Delete('sick/:id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: SickDeleteDto,
  ): Promise<void> {
    return this.sick.remove(user, id, dto.reason);
  }

  @Patch('employees/:id/certificate-from-day1')
  @Roles('ADMIN')
  @HttpCode(200)
  async certificateFromDay1(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: CertificateFromDay1Dto,
  ): Promise<{ value: boolean }> {
    await this.sick.setCertificateFromDay1(user, id, dto.value);
    return { value: dto.value };
  }
}
