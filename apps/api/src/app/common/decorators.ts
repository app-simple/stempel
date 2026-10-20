import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import type { Role } from '@as/shared';
import type { AppRequest, AuthUser } from './auth-user';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Route ohne Anmeldung erreichbar. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/** Route nur für diese Rollen. Ohne Angabe: jede angemeldete Person. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AppRequest>().user;
  if (!user) throw new UnauthorizedException('Bitte anmelden.');
  return user;
});
