import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  LEAVE_STATUSES,
  type LeaveAccountView,
  type LeaveCalendarView,
  type LeaveLedgerView,
  type LeavePreview,
  type LeaveRequestView,
  type LeaveStatus,
} from '@as/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { LeaveInputDto, LeaveLedgerDto, LeaveRejectDto } from './leave.dto';
import { LeaveService } from './leave.service';

const uuid = new ParseUUIDPipe();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optionalUuid(value: string | undefined): string | undefined {
  if (value !== undefined && !UUID.test(value))
    throw new BadRequestException('Ungültige employeeId.');
  return value;
}

function parseYear(value: string | undefined, fallback?: number): number {
  const year = value === undefined ? fallback : Number(value);
  if (year === undefined || !Number.isInteger(year) || year < 2000 || year > 2100)
    throw new BadRequestException('Bitte ein gültiges Jahr angeben.');
  return year;
}

/** Abwesenheiten (Spezifikation Phase 3, Abschnitt 8). Rechte prüft der Service je Person. */
@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Post('preview')
  @HttpCode(200)
  preview(@CurrentUser() user: AuthUser, @Body() dto: LeaveInputDto): Promise<LeavePreview> {
    return this.leave.preview(user, dto);
  }

  @Post('requests')
  create(@CurrentUser() user: AuthUser, @Body() dto: LeaveInputDto): Promise<LeaveRequestView> {
    return this.leave.create(user, dto);
  }

  @Get('requests')
  list(
    @CurrentUser() user: AuthUser,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
    @Query('year') year?: string,
  ): Promise<LeaveRequestView[]> {
    if (status !== undefined && !(LEAVE_STATUSES as readonly string[]).includes(status))
      throw new BadRequestException('Ungültiger Status.');
    const id = optionalUuid(employeeId);
    return this.leave.list(user, {
      ...(id ? { employeeId: id } : {}),
      ...(status ? { status: status as LeaveStatus } : {}),
      ...(year !== undefined ? { year: parseYear(year) } : {}),
    });
  }

  @Post('requests/:id/withdraw')
  @HttpCode(200)
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<LeaveRequestView> {
    return this.leave.withdraw(user, id);
  }

  @Post('requests/:id/approve')
  @HttpCode(200)
  approve(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<LeaveRequestView> {
    return this.leave.approve(user, id);
  }

  @Post('requests/:id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: LeaveRejectDto,
  ): Promise<LeaveRequestView> {
    return this.leave.reject(user, id, dto.reason);
  }

  @Post('requests/:id/cancellation')
  @HttpCode(200)
  requestCancellation(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<LeaveRequestView> {
    return this.leave.requestCancellation(user, id);
  }

  @Post('requests/:id/cancellation/approve')
  @HttpCode(200)
  approveCancellation(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<LeaveRequestView> {
    return this.leave.approveCancellation(user, id);
  }

  @Post('requests/:id/cancellation/reject')
  @HttpCode(200)
  rejectCancellation(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<LeaveRequestView> {
    return this.leave.rejectCancellation(user, id);
  }

  @Get('account')
  account(
    @CurrentUser() user: AuthUser,
    @Query('employeeId') employeeId?: string,
    @Query('year') year?: string,
  ): Promise<LeaveAccountView> {
    return this.leave.account(
      user,
      optionalUuid(employeeId) ?? user.id,
      parseYear(year, Number(new Date().getFullYear())),
    );
  }

  @Get('accounts')
  @Roles('LEAD', 'ADMIN')
  accounts(
    @CurrentUser() user: AuthUser,
    @Query('year') year?: string,
  ): Promise<LeaveAccountView[]> {
    return this.leave.accounts(user, parseYear(year, Number(new Date().getFullYear())));
  }

  @Get('calendar')
  calendar(
    @CurrentUser() user: AuthUser,
    @Query('month') month?: string,
  ): Promise<LeaveCalendarView> {
    return this.leave.calendar(user, month ?? '');
  }
}

/** Korrekturbuchungen am Urlaubskonto, nur Admin (Entscheidung 10). */
@Controller('employees')
export class LeaveLedgerController {
  constructor(private readonly leave: LeaveService) {}

  @Get(':id/leave-ledger')
  @Roles('ADMIN')
  list(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<LeaveLedgerView[]> {
    return this.leave.ledger(user, id);
  }

  @Post(':id/leave-ledger')
  @Roles('ADMIN')
  add(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: LeaveLedgerDto,
  ): Promise<LeaveLedgerView[]> {
    return this.leave.addLedger(user, id, dto);
  }
}
