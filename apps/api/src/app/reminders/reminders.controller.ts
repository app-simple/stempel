import {
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
import type {
  LateEntriesView,
  PushDeviceView,
  ReminderSettingsView,
  ReminderTodayView,
} from '@as/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { LateEntriesService } from './late-entries.service';
import { EmailFallbackDto, PushSubscriptionDto, ReminderSettingsDto } from './reminders.dto';
import { RemindersService } from './reminders.service';

/** Erinnerungen der angemeldeten Person (Spezifikation Phase 5, Abschnitt 8). */
@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get('today')
  today(@CurrentUser() user: AuthUser): Promise<ReminderTodayView> {
    return this.reminders.today(user);
  }

  @Post('mute')
  @HttpCode(204)
  mute(@CurrentUser() user: AuthUser): Promise<void> {
    return this.reminders.mute(user);
  }
}

@Controller('push')
export class PushController {
  constructor(private readonly reminders: RemindersService) {}

  @Get('public-key')
  publicKey(): { publicKey: string | null } {
    return this.reminders.publicKey();
  }
}

/** Geräte für Push und E-Mail-Rückfall, nur die eigene Person. */
@Controller('me')
export class MeRemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get('push-subscriptions')
  devices(@CurrentUser() user: AuthUser): Promise<PushDeviceView[]> {
    return this.reminders.devices(user);
  }

  @Post('push-subscriptions')
  subscribe(
    @CurrentUser() user: AuthUser,
    @Body() dto: PushSubscriptionDto,
  ): Promise<PushDeviceView[]> {
    return this.reminders.subscribe(user, dto);
  }

  @Post('push-subscriptions/test')
  @HttpCode(200)
  test(@CurrentUser() user: AuthUser): Promise<{ delivered: number }> {
    return this.reminders.test(user);
  }

  @Delete('push-subscriptions/:id')
  @HttpCode(204)
  unsubscribe(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.reminders.unsubscribe(user, id);
  }

  @Patch('reminder-settings')
  emailFallback(
    @CurrentUser() user: AuthUser,
    @Body() dto: EmailFallbackDto,
  ): Promise<{ emailFallback: boolean }> {
    return this.reminders.setEmailFallback(user, dto.emailFallback);
  }
}

/** Auswertung der Nachträge (Entscheidung 8). */
@Controller()
export class LateEntriesController {
  constructor(private readonly late: LateEntriesService) {}

  @Get('checks/late-entries')
  @Roles('LEAD', 'ADMIN')
  team(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<LateEntriesView> {
    return this.late.team(user, { ...(from ? { from } : {}), ...(to ? { to } : {}) });
  }

  @Get('time/late-entries')
  own(@CurrentUser() user: AuthUser): Promise<LateEntriesView> {
    return this.late.own(user);
  }

  @Get('settings/reminders')
  @Roles('ADMIN')
  settings(): Promise<ReminderSettingsView> {
    return this.late.settings();
  }

  @Put('settings/reminders')
  @Roles('ADMIN')
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReminderSettingsDto,
  ): Promise<ReminderSettingsView> {
    return this.late.updateSettings(user, dto);
  }
}
