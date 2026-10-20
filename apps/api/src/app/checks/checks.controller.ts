import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type {
  ChecksView,
  ForfeitureSuggestion,
  LeaveNoticeView,
  RetentionSettingsView,
} from '@as/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { ChecksService } from './checks.service';
import { ForfeitureDto, RetentionDto, SendNoticesDto } from './checks.dto';
import { NoticesService } from './notices.service';
import { RetentionService } from './retention.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prüfseite (Spezifikation Phase 4, Entscheidung 1). */
@Controller('checks')
export class ChecksController {
  constructor(private readonly checks: ChecksService) {}

  @Get()
  @Roles('LEAD', 'ADMIN')
  get(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<ChecksView> {
    return this.checks.checks(user, { ...(from ? { from } : {}), ...(to ? { to } : {}) });
  }
}

/** Urlaubshinweis und Verfall (Entscheidungen 2, 3, 3a). */
@Controller('leave')
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get('notices')
  list(
    @CurrentUser() user: AuthUser,
    @Query('employeeId') employeeId?: string,
    @Query('year') year?: string,
  ): Promise<LeaveNoticeView[]> {
    if (employeeId !== undefined && !UUID.test(employeeId))
      throw new BadRequestException('Ungültige employeeId.');
    const y = year === undefined ? undefined : Number(year);
    if (y !== undefined && (!Number.isInteger(y) || y < 2000 || y > 2100))
      throw new BadRequestException('Bitte ein gültiges Jahr angeben.');
    return this.notices.list(user, {
      ...(employeeId ? { employeeId } : {}),
      ...(y ? { year: y } : {}),
    });
  }

  @Post('notices')
  @Roles('ADMIN')
  send(@CurrentUser() user: AuthUser, @Body() dto: SendNoticesDto): Promise<LeaveNoticeView[]> {
    return this.notices.send(user, {
      year: dto.year,
      ...(dto.employeeIds ? { employeeIds: dto.employeeIds } : {}),
    });
  }

  @Post('notices/:id/read')
  @HttpCode(200)
  read(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<LeaveNoticeView> {
    return this.notices.markRead(user, id);
  }

  @Post('forfeitures')
  @Roles('ADMIN')
  forfeit(
    @CurrentUser() user: AuthUser,
    @Body() dto: ForfeitureDto,
  ): Promise<ForfeitureSuggestion> {
    return this.notices.bookForfeiture(user, dto);
  }
}

/** Aufbewahrung und Löschjob (Entscheidung 6). */
@Controller('settings/retention')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get()
  @Roles('ADMIN')
  get(): Promise<RetentionSettingsView> {
    return this.retention.settings();
  }

  @Put()
  @Roles('ADMIN')
  update(@CurrentUser() user: AuthUser, @Body() dto: RetentionDto): Promise<RetentionSettingsView> {
    return this.retention.updateSettings(user, dto);
  }
}
