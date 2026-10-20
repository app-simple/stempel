import { Module } from '@nestjs/common';
import { SickController } from './sick.controller';
import { SickService } from './sick.service';

@Module({
  controllers: [SickController],
  providers: [SickService],
  exports: [SickService],
})
export class SickModule {}
