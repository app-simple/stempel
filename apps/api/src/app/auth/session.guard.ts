import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { AppRequest } from '../common/auth-user';
import { IS_PUBLIC } from '../common/decorators';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { sessionCookieName, setSessionCookie } from './session-cookie';
import { SessionService } from './session.service';

/** Globaler Guard: jede Route braucht eine gültige Sitzung, außer sie ist mit @Public() markiert. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const http = context.switchToHttp();
    const req = http.getRequest<AppRequest>();
    const token: unknown = req.cookies?.[sessionCookieName(this.config)];

    if (typeof token === 'string' && token.length > 0) {
      const resolved = await this.sessions.resolve(token);
      if (resolved) {
        req.user = resolved.user;
        if (resolved.renewed) setSessionCookie(http.getResponse<Response>(), this.config, token);
      }
    }

    if (isPublic || req.user) return true;
    throw new UnauthorizedException('Bitte anmelden.');
  }
}
