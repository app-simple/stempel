import { Module } from '@nestjs/common';
import { CompanySettingsController, HolidaysController } from './holidays.controller';
import { HolidaysService } from './holidays.service';
import { SchoolHolidaysController, SchoolHolidaysService } from './school-holidays';

@Module({
  controllers: [HolidaysController, CompanySettingsController, SchoolHolidaysController],
  providers: [HolidaysService, SchoolHolidaysService],
})
export class HolidaysModule {}
