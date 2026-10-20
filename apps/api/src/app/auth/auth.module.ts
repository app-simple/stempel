import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthCleanupService } from './cleanup.service';
import { LoginCodeService } from './login-code.service';
import { PasskeyService } from './passkey.service';
import { PasskeysController } from './passkeys.controller';
import { RateLimitService } from './rate-limit.service';
import { RolesGuard } from './roles.guard';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController, PasskeysController],
  providers: [
    LoginCodeService,
    PasskeyService,
    SessionService,
    RateLimitService,
    AuthCleanupService,
    // Reihenfolge: erst Sitzung, dann Rolle.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [SessionService, RateLimitService],
})
export class AuthModule {}
