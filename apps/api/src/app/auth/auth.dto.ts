import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class RequestCodeDto {
  @Transform(trim)
  @IsEmail({}, { message: 'Bitte eine gültige E-Mail-Adresse eingeben.' })
  @MaxLength(254)
  email!: string;
}

export class VerifyCodeDto {
  @Transform(trim)
  @IsEmail({}, { message: 'Bitte eine gültige E-Mail-Adresse eingeben.' })
  @MaxLength(254)
  email!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 12)
  code!: string;
}

const BASE64URL = /^[A-Za-z0-9_-]*$/;
const MAX_FIELD = 16_384;

class AssertionPayloadDto {
  @IsString() @Matches(BASE64URL) @MaxLength(MAX_FIELD) clientDataJSON!: string;
  @IsString() @Matches(BASE64URL) @MaxLength(MAX_FIELD) authenticatorData!: string;
  @IsString() @Matches(BASE64URL) @MaxLength(MAX_FIELD) signature!: string;
  @IsOptional() @IsString() @Matches(BASE64URL) @MaxLength(1024) userHandle?: string;
}

class AttestationPayloadDto {
  @IsString() @Matches(BASE64URL) @MaxLength(MAX_FIELD) clientDataJSON!: string;
  @IsString() @Matches(BASE64URL) @MaxLength(MAX_FIELD) attestationObject!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) transports?: string[];
  @IsOptional() @IsString() @Matches(BASE64URL) @MaxLength(MAX_FIELD) authenticatorData?: string;
  @IsOptional() @IsInt() publicKeyAlgorithm?: number;
  @IsOptional() @IsString() @Matches(BASE64URL) @MaxLength(MAX_FIELD) publicKey?: string;
}

/** Struktur einer WebAuthn-Antwort; die kryptografische Prüfung übernimmt SimpleWebAuthn. */
class CredentialDtoBase {
  @IsString() @Matches(BASE64URL) @MaxLength(1024) id!: string;
  @IsString() @Matches(BASE64URL) @MaxLength(1024) rawId!: string;
  @IsIn(['public-key']) type!: 'public-key';
  @IsObject() clientExtensionResults!: Record<string, unknown>;
  @IsOptional() @IsIn(['platform', 'cross-platform']) authenticatorAttachment?:
    'platform' | 'cross-platform';
}

class AuthenticationCredentialDto extends CredentialDtoBase {
  @IsDefined()
  @ValidateNested()
  @Type(() => AssertionPayloadDto)
  response!: AssertionPayloadDto;
}

class RegistrationCredentialDto extends CredentialDtoBase {
  @IsDefined()
  @ValidateNested()
  @Type(() => AttestationPayloadDto)
  response!: AttestationPayloadDto;
}

export class PasskeyLoginDto {
  @IsDefined({ message: 'Antwort des Passkeys fehlt.' })
  @ValidateNested()
  @Type(() => AuthenticationCredentialDto)
  response!: AuthenticationResponseJSON;
}

export class PasskeyRegistrationDto {
  @IsDefined({ message: 'Antwort des Passkeys fehlt.' })
  @ValidateNested()
  @Type(() => RegistrationCredentialDto)
  response!: RegistrationResponseJSON;

  @IsString()
  @IsNotEmpty({ message: 'Bitte einen Namen für das Gerät angeben.' })
  @MaxLength(60)
  name!: string;
}

export class RenamePasskeyDto {
  @IsString()
  @IsNotEmpty({ message: 'Bitte einen Namen für das Gerät angeben.' })
  @MaxLength(60)
  name!: string;
}
