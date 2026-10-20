import { Module } from '@nestjs/common';
import { LeaveController, LeaveLedgerController } from './leave.controller';
import { LeaveMailService } from './leave-mail.service';
import { LeaveOverdueService } from './leave-overdue.service';
import { LeaveService } from './leave.service';

@Module({
  controllers: [LeaveController, LeaveLedgerController],
  providers: [LeaveService, LeaveMailService, LeaveOverdueService],
  exports: [LeaveService],
})
export class LeaveModule {}
