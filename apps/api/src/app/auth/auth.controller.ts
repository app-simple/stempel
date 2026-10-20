import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { LoginMethod, Role } from '@as/shared';
import type { AppRequest, AuthUser } from '../common/auth-user';
import { CurrentUser, Public } from '../common/decorators';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { PasskeyLoginDto, RequestCodeDto, VerifyCodeDto } from './auth.dto';
import { LoginCodeService } from './login-code.service';
import { PasskeyService } from './passkey.service';
import { RATE_LIMITS, RateLimitService } from './rate-limit.service';
import {
  challengeCookieName,
  clearChallengeCookie,
  clearSessionCookie,
  setChallengeCookie,
  setSessionCookie,
} from './session-cookie';
import { SessionService } from './session.service';

export const CODE_REQUESTED_MESSAGE =
  'Wenn die Adresse bei uns hinterlegt ist, ist ein Code unterwegs.';

export interface SessionView {
  id: string;
  name: string;
  role: Role;
  method: LoginMethod;
}

function clientIp(req: AppRequest): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly codes: LoginCodeService,
    private readonly passkeys: PasskeyService,
    private readonly sessions: SessionService,
    private readonly rateLimit: RateLimitService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('code/request')
  @HttpCode(202)
  async requestCode(
    @Body() body: RequestCodeDto,
    @Req() req: AppRequest,
  ): Promise<{ message: string }> {
    await this.codes.request(body.email, clientIp(req));
    return { message: CODE_REQUESTED_MESSAGE };
  }

  @Public()
  @Post('code/verify')
  @HttpCode(200)
  async verifyCode(
    @Body() body: VerifyCodeDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const token = await this.codes.verify(body.email, body.code, clientIp(req));
    setSessionCookie(res, this.config, token);
    return { ok: true };
  }

  @Public()
  @Post('passkey/options')
  @HttpCode(200)
  async passkeyOptions(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    await this.rateLimit.consume(RATE_LIMITS.passkeyLoginPerIp, clientIp(req));
    const { challengeId, options } = await this.passkeys.loginOptions();
    setChallengeCookie(res, this.config, challengeId);
    return options;
  }

  @Public()
  @Post('passkey/verify')
  @HttpCode(200)
  async passkeyVerify(
    @Body() body: PasskeyLoginDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.rateLimit.consume(RATE_LIMITS.passkeyLoginPerIp, clientIp(req));
    const challengeId: unknown = req.cookies?.[challengeCookieName(this.config)];
    clearChallengeCookie(res, this.config);
    const token = await this.passkeys.verifyLogin(
      typeof challengeId === 'string' ? challengeId : undefined,
      body.response,
    );
    setSessionCookie(res, this.config, token);
    return { ok: true };
  }

  @Get('session')
  async session(@CurrentUser() user: AuthUser): Promise<SessionView> {
    const session = await this.prisma.session.findUniqueOrThrow({
      where: { id: user.sessionId },
      select: { method: true },
    });
    return { id: user.id, name: user.name, role: user.role, method: session.method };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.revoke(user);
    clearSessionCookie(res, this.config);
  }

  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.revokeAll(user.id, user.id);
    clearSessionCookie(res, this.config);
  }
}
