import { Module } from '@nestjs/common';
import { OvertimeAdminController, TimeController } from './time.controller';
import { TimeService } from './time.service';

@Module({
  controllers: [TimeController, OvertimeAdminController],
  providers: [TimeService],
  exports: [TimeService],
})
export class TimeModule {}
