import { Pipe, type PipeTransform } from '@angular/core';
import {
  EMPLOYMENT_TYPE_LABELS,
  formatEuro,
  formatHoursMinutes,
  formatLocalDate,
  ROLE_LABELS,
  WEEKDAY_SHORT,
  type EmploymentType,
  type IsoWeekday,
  type Role,
} from '@as/shared';

@Pipe({ name: 'localDate' })
export class LocalDatePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return value ? formatLocalDate(value) : '–';
  }
}

@Pipe({ name: 'hm' })
export class HoursMinutesPipe implements PipeTransform {
  transform(minutes: number | null | undefined): string {
    return minutes === null || minutes === undefined ? '–' : formatHoursMinutes(minutes);
  }
}

@Pipe({ name: 'euro' })
export class EuroPipe implements PipeTransform {
  transform(cents: number | null | undefined): string {
    return cents === null || cents === undefined ? '–' : formatEuro(cents);
  }
}

@Pipe({ name: 'weekdays' })
export class WeekdaysPipe implements PipeTransform {
  transform(days: readonly IsoWeekday[] | null | undefined): string {
    return (days ?? []).map((d) => WEEKDAY_SHORT[d]).join(' ');
  }
}

@Pipe({ name: 'roleLabel' })
export class RoleLabelPipe implements PipeTransform {
  transform(role: Role): string {
    return ROLE_LABELS[role];
  }
}

@Pipe({ name: 'typeLabel' })
export class EmploymentTypeLabelPipe implements PipeTransform {
  transform(type: EmploymentType): string {
    return EMPLOYMENT_TYPE_LABELS[type];
  }
}
