import { Injectable } from '@nestjs/common';
import { localDateInBerlin, type LocalDate } from '@as/shared';

/** Zeitquelle, in Tests austauschbar. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }

  /** Heutiges Datum in Europe/Berlin. */
  today(): LocalDate {
    return localDateInBerlin(this.now());
  }
}
