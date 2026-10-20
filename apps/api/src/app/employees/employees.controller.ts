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
  Put,
} from '@nestjs/common';
import type { AdminEmployeeView, EmployeeView, TermsSaveResult, TermsView } from '@as/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { CarryOverDto, CreateEmployeeDto, TermsDto, UpdateEmployeeDto } from './employee.dto';
import { EmployeesService } from './employees.service';

const uuid = new ParseUUIDPipe();

/**
 * Mitarbeiter: lesen für Vorgesetzte (eigenes Team) und Admin, schreiben nur Admin.
 * Mitarbeiter lesen ihre eigenen Daten über /me.
 */
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @Roles('LEAD', 'ADMIN')
  list(@CurrentUser() user: AuthUser): Promise<EmployeeView[] | AdminEmployeeView[]> {
    return this.employees.list(user);
  }

  @Get(':id')
  @Roles('LEAD', 'ADMIN')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<EmployeeView | AdminEmployeeView> {
    return this.employees.get(user, id);
  }

  @Post()
  @Roles('ADMIN')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateEmployeeDto,
  ): Promise<AdminEmployeeView> {
    return this.employees.create(user, dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<AdminEmployeeView> {
    return this.employees.update(user, id, dto);
  }

  @Post(':id/lock')
  @HttpCode(200)
  @Roles('ADMIN')
  lock(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<AdminEmployeeView> {
    return this.employees.lock(user, id);
  }

  @Post(':id/unlock')
  @HttpCode(200)
  @Roles('ADMIN')
  unlock(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<AdminEmployeeView> {
    return this.employees.unlock(user, id);
  }

  @Put(':id/carry-over/:year')
  @Roles('ADMIN')
  carryOver(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('year', ParseIntPipe) year: number,
    @Body() dto: CarryOverDto,
  ): Promise<{ year: number; days: number }> {
    return this.employees.setCarryOver(user, id, year, dto.days);
  }

  @Get(':id/terms')
  @Roles('LEAD', 'ADMIN')
  listTerms(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<TermsView[]> {
    return this.employees.listTerms(user, id);
  }

  @Post(':id/terms')
  @Roles('ADMIN')
  createTerms(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: TermsDto,
  ): Promise<TermsSaveResult> {
    return this.employees.createTerms(user, id, dto);
  }

  @Patch(':id/terms/:termsId')
  @Roles('ADMIN')
  updateTerms(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('termsId', uuid) termsId: string,
    @Body() dto: TermsDto,
  ): Promise<TermsSaveResult> {
    return this.employees.updateTerms(user, id, termsId, dto);
  }

  @Delete(':id/terms/:termsId')
  @HttpCode(204)
  @Roles('ADMIN')
  deleteTerms(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('termsId', uuid) termsId: string,
  ): Promise<void> {
    return this.employees.deleteTerms(user, id, termsId);
  }
}
