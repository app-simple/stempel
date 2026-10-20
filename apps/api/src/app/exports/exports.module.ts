import { Module } from '@nestjs/common';
import { TimeModule } from '../time/time.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [TimeModule],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
