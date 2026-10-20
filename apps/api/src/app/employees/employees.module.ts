import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { MeController } from './me.controller';
import { TermsValidationService } from './terms-validation.service';

@Module({
  controllers: [EmployeesController, MeController],
  providers: [EmployeesService, TermsValidationService],
})
export class EmployeesModule {}
