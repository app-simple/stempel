import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { PasskeyRegistrationDto, RenamePasskeyDto } from './auth.dto';
import { PasskeyService, type PasskeyView } from './passkey.service';

/** Eigene Passkeys. Jede Abfrage ist auf die angemeldete Person beschränkt. */
@Controller('me/passkeys')
export class PasskeysController {
  constructor(private readonly passkeys: PasskeyService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<PasskeyView[]> {
    return this.passkeys.list(user);
  }

  @Post('registration/options')
  @HttpCode(200)
  registrationOptions(
    @CurrentUser() user: AuthUser,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return this.passkeys.registrationOptions(user);
  }

  @Post('registration/verify')
  @HttpCode(201)
  registrationVerify(
    @CurrentUser() user: AuthUser,
    @Body() body: PasskeyRegistrationDto,
  ): Promise<PasskeyView> {
    return this.passkeys.verifyRegistration(user, body.response, body.name.trim());
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RenamePasskeyDto,
  ): Promise<PasskeyView> {
    return this.passkeys.rename(user, id, body.name.trim());
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.passkeys.remove(user, id);
  }
}
