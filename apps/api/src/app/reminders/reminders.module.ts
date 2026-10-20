import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LateEntriesService } from './late-entries.service';
import { PushService, WebPushService } from './push.service';
import {
  LateEntriesController,
  MeRemindersController,
  PushController,
  RemindersController,
} from './reminders.controller';
import { RemindersService } from './reminders.service';

@Module({
  imports: [AuthModule],
  controllers: [RemindersController, PushController, MeRemindersController, LateEntriesController],
  providers: [
    RemindersService,
    LateEntriesService,
    { provide: PushService, useClass: WebPushService },
  ],
})
export class RemindersModule {}
