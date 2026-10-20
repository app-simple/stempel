import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@as/shared';
import type { AppRequest } from '../common/auth-user';
import { ROLES } from '../common/decorators';

/** Prüft @Roles(...). Läuft nach dem SessionGuard; falsche Rolle ergibt 403. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;
    const user = context.switchToHttp().getRequest<AppRequest>().user;
    if (user && roles.includes(user.role)) return true;
    throw new ForbiddenException('Dafür fehlt die Berechtigung.');
  }
}
