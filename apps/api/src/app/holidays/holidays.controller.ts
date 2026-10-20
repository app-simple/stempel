import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { CompanySettingsView, HolidayView } from '@as/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { CreateHolidayDto, UpdateHolidayDto, UpdateSettingsDto } from './holiday.dto';
import { HolidaysService } from './holidays.service';

@Controller('holidays')
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  /** Feiertage enthalten keine personenbezogenen Daten und sind für alle Angemeldeten lesbar. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('year', ParseIntPipe) year: number,
  ): Promise<HolidayView[]> {
    return this.holidays.list(user, year);
  }

  @Post()
  @Roles('ADMIN')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateHolidayDto): Promise<HolidayView> {
    return this.holidays.create(user, dto.date, dto.name);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateHolidayDto,
  ): Promise<HolidayView> {
    return this.holidays.update(user, id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.active !== undefined ? { active: dto.active } : {}),
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles('ADMIN')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.holidays.remove(user, id);
  }
}

@Controller('settings/company')
export class CompanySettingsController {
  constructor(private readonly holidays: HolidaysService) {}

  @Get()
  get(): Promise<CompanySettingsView> {
    return this.holidays.settings();
  }

  @Patch()
  @Roles('ADMIN')
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateSettingsDto,
  ): Promise<CompanySettingsView> {
    return this.holidays.updateSettings(user, dto.assumptionDayIsHoliday);
  }
}
