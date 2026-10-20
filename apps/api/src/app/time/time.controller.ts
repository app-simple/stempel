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
  ClockResult,
  CorrectionRequestView,
  CorrectionResult,
  EntrySaveResult,
  MonthClosingView,
  MonthView,
  OvertimeView,
  RevisionView,
  TeamTodayRow,
  TodayView,
  WeekView,
} from '@as/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import {
  CorrectionDto,
  ManualEntryDto,
  OvertimeAccountDto,
  OvertimeAdjustmentDto,
  ReasonDto,
} from './time.dto';
import { TimeService } from './time.service';

const uuid = new ParseUUIDPipe();

function requireUuid(value: string | undefined, fallback: string): string {
  const id = value ?? fallback;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new BadRequestException('Ungültige employeeId.');
  return id;
}

/** Zeiterfassung. Sichtbarkeit über den zentralen Filter; Stempeln nur für sich selbst. */
@Controller('time')
export class TimeController {
  constructor(private readonly time: TimeService) {}

  @Get('today')
  today(@CurrentUser() user: AuthUser): Promise<TodayView> {
    return this.time.today(user);
  }

  @Post('clock/in')
  @HttpCode(200)
  clockIn(@CurrentUser() user: AuthUser): Promise<ClockResult> {
    return this.time.clockIn(user);
  }

  @Post('clock/break-start')
  @HttpCode(200)
  breakStart(@CurrentUser() user: AuthUser): Promise<ClockResult> {
    return this.time.breakStart(user);
  }

  @Post('clock/break-end')
  @HttpCode(200)
  breakEnd(@CurrentUser() user: AuthUser): Promise<ClockResult> {
    return this.time.breakEnd(user);
  }

  @Post('clock/out')
  @HttpCode(200)
  clockOut(@CurrentUser() user: AuthUser): Promise<ClockResult> {
    return this.time.clockOut(user);
  }

  @Get('week')
  week(
    @CurrentUser() user: AuthUser,
    @Query('week') week: string,
    @Query('employeeId') employeeId?: string,
  ): Promise<WeekView> {
    return this.time.week(user, requireUuid(employeeId, user.id), week ?? '');
  }

  @Get('month')
  month(
    @CurrentUser() user: AuthUser,
    @Query('month') month: string,
    @Query('employeeId') employeeId?: string,
  ): Promise<MonthView> {
    return this.time.month(user, requireUuid(employeeId, user.id), month ?? '');
  }

  @Get('team-today')
  @Roles('LEAD', 'ADMIN')
  teamToday(@CurrentUser() user: AuthUser): Promise<TeamTodayRow[]> {
    return this.time.teamToday(user);
  }

  @Post('entries')
  createManual(
    @CurrentUser() user: AuthUser,
    @Body() dto: ManualEntryDto,
  ): Promise<EntrySaveResult> {
    return this.time.createManual(user, dto);
  }

  @Post('entries/:id/correct')
  @HttpCode(200)
  correct(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: CorrectionDto,
  ): Promise<CorrectionResult> {
    return this.time.correct(user, id, dto);
  }

  @Post('entries/:id/void')
  @HttpCode(200)
  void(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: ReasonDto,
  ): Promise<CorrectionResult> {
    return this.time.void(user, id, dto.reason);
  }

  @Get('entries/:id/revisions')
  revisions(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<RevisionView[]> {
    return this.time.revisions(user, id);
  }

  @Get('corrections')
  corrections(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
  ): Promise<CorrectionRequestView[]> {
    if (
      status !== undefined &&
      !['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'].includes(status)
    ) {
      throw new BadRequestException('Ungültiger Status.');
    }
    return this.time.listCorrections(user, status);
  }

  @Post('corrections/:id/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<CorrectionRequestView> {
    return this.time.approve(user, id);
  }

  @Post('corrections/:id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: ReasonDto,
  ): Promise<CorrectionRequestView> {
    return this.time.reject(user, id, dto.reason);
  }

  @Post('corrections/:id/withdraw')
  @HttpCode(200)
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<CorrectionRequestView> {
    return this.time.withdraw(user, id);
  }

  @Get('months')
  months(@CurrentUser() user: AuthUser): Promise<MonthClosingView[]> {
    return this.time.listClosings(user);
  }

  @Post('months/:month/close')
  @HttpCode(200)
  closeMonth(
    @CurrentUser() user: AuthUser,
    @Param('month') month: string,
  ): Promise<MonthClosingView> {
    return this.time.closeMonth(user, month);
  }

  @Post('months/:employeeId/:month/reopen')
  @HttpCode(200)
  @Roles('ADMIN')
  reopenMonth(
    @CurrentUser() user: AuthUser,
    @Param('employeeId', uuid) employeeId: string,
    @Param('month') month: string,
  ): Promise<MonthClosingView> {
    return this.time.reopenMonth(user, employeeId, month);
  }

  @Get('overtime')
  overtime(
    @CurrentUser() user: AuthUser,
    @Query('employeeId') employeeId?: string,
  ): Promise<OvertimeView | null> {
    return this.time.overtime(user, requireUuid(employeeId, user.id));
  }
}

/** Überstundenkonto verwalten, nur Admin (Entscheidung 7). */
@Controller('employees')
export class OvertimeAdminController {
  constructor(private readonly time: TimeService) {}

  @Put(':id/overtime-account')
  @Roles('ADMIN')
  setAccount(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: OvertimeAccountDto,
  ): Promise<OvertimeView | null> {
    return this.time.setOvertimeAccount(user, id, dto.since);
  }

  @Post(':id/overtime-adjustments')
  @Roles('ADMIN')
  addAdjustment(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: OvertimeAdjustmentDto,
  ): Promise<OvertimeView | null> {
    return this.time.addOvertimeAdjustment(user, id, dto);
  }
}
