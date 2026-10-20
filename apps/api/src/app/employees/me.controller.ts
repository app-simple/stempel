import { Controller, Get } from '@nestjs/common';
import type { ProfileView } from '@as/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { EmployeesService } from './employees.service';

/** Eigene Daten für jede angemeldete Person. */
@Controller('me')
export class MeController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  profile(@CurrentUser() user: AuthUser): Promise<ProfileView> {
    return this.employees.profile(user);
  }
}
