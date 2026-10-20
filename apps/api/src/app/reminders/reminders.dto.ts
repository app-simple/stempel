import { Type } from 'class-transformer';
import { isAuthSecret, isP256dhKey, isPushServiceEndpoint } from './push-endpoint';
import {
  IsDefined,
  IsObject,
  IsBoolean,
  registerDecorator,
  type ValidationOptions,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Prüfung über eine Funktion mit eigener Meldung. */
function Validate(check: (value: unknown) => boolean, message: string): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: check.name,
      target: target.constructor,
      propertyName: String(propertyName),
      options: { message },
      validator: { validate: check },
    });
  };
}

function IsPushServiceEndpoint(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isPushServiceEndpoint',
      target: target.constructor,
      propertyName: String(propertyName),
      options: { message: 'Dieser Push-Dienst wird nicht unterstützt.', ...options },
      validator: { validate: isPushServiceEndpoint },
    });
  };
}

class PushKeysDto {
  @Validate(isP256dhKey, 'Ungültiger Schlüssel des Geräts.')
  p256dh!: string;

  @Validate(isAuthSecret, 'Ungültiger Schlüssel des Geräts.')
  auth!: string;
}

export class PushSubscriptionDto {
  @IsPushServiceEndpoint()
  endpoint!: string;

  @IsDefined({ message: 'Schlüssel des Geräts fehlen.' })
  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  deviceName!: string;
}

export class EmailFallbackDto {
  @IsBoolean()
  emailFallback!: boolean;
}

export class ReminderSettingsDto {
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Bitte eine Uhrzeit im Format HH:MM angeben.' })
  defaultStart!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  lateFlagMinCount!: number;

  @IsInt()
  @Min(1)
  @Max(100)
  lateFlagMinPercent!: number;

  @IsInt()
  @Min(1)
  @Max(52)
  lateFlagWeeks!: number;
}
