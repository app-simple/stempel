import { isLocalDate, isTimeInput } from '@as/shared';
import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Kalendertag im Format JJJJ-MM-TT. */
export function IsLocalDate(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isLocalDate',
      target: target.constructor,
      propertyName: String(propertyName),
      options: { message: 'Bitte ein gültiges Datum angeben.', ...options },
      validator: { validate: (value: unknown) => isLocalDate(value) },
    });
  };
}

/** Uhrzeit im Format HH:MM, am Tag der Rückstellung optional HH:MMW für die zweite Stunde. */
export function IsTimeOfDay(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isTimeOfDay',
      target: target.constructor,
      propertyName: String(propertyName),
      options: { message: 'Bitte eine Uhrzeit im Format HH:MM angeben.', ...options },
      validator: { validate: (value: unknown) => isTimeInput(value) },
    });
  };
}
