import { Module } from '@nestjs/common';
import { TimeModule } from '../time/time.module';
import { ChecksController, NoticesController, RetentionController } from './checks.controller';
import { ChecksService } from './checks.service';
import { NoticesService } from './notices.service';
import { RetentionService } from './retention.service';

@Module({
  imports: [TimeModule],
  controllers: [ChecksController, NoticesController, RetentionController],
  providers: [ChecksService, NoticesService, RetentionService],
})
export class ChecksModule {}
