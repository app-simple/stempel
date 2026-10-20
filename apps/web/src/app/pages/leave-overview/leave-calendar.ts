import { Component, computed, inject, resource, signal } from '@angular/core';
import {
  addDays,
  isoWeek,
  isoWeekday,
  localDateInBerlin,
  mondayOf,
  WEEKDAY_SHORT,
  type CalendarRow,
  type IsoWeekday,
  type LeaveCalendarView,
} from '@as/shared';
import { LucideChevronLeft, LucideChevronRight } from '@lucide/angular';
import { ApiService } from '../../core/api.service';
import { mediaQuery, NARROW } from '../../core/media';
import { SessionStore } from '../../core/session.store';

@Component({
  selector: 'app-leave-calendar',
  imports: [LucideChevronLeft, LucideChevronRight],
  styles: `
    :host {
      display: block;
      min-width: 0;
      max-width: 100%;
      /* Die intrinsische Tabellenbreite darf keine übergeordneten Flex-Items aufweiten. */
      contain: inline-size;
    }
    .calendar-region {
      width: 100%;
      min-width: 0;
      max-width: 100%;
    }
    .calendar-region.week {
      touch-action: pan-y;
    }
    .week .cal {
      width: 100%;
      table-layout: fixed;
    }
    .week .cal .n {
      width: 30%;
      padding-right: 6px;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .week .cal th.d {
      min-width: 0;
    }
  `,
  template: `
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 aria-live="polite">{{ periodLabel() }}</h2>
      <div class="flex gap-2">
        <button
          type="button"
          class="btn btn-sm"
          (click)="move(-1)"
          [attr.aria-label]="narrow() ? 'Vorige Woche' : 'Voriger Monat'"
        >
          <svg lucideChevronLeft [size]="16" aria-hidden="true"></svg>
          {{ narrow() ? 'Woche' : 'Monat' }}
        </button>
        <button type="button" class="btn btn-sm" (click)="goToday()">Heute</button>
        <button
          type="button"
          class="btn btn-sm"
          (click)="move(1)"
          [attr.aria-label]="narrow() ? 'Nächste Woche' : 'Nächster Monat'"
        >
          {{ narrow() ? 'Woche' : 'Monat' }}
          <svg lucideChevronRight [size]="16" aria-hidden="true"></svg>
        </button>
      </div>
    </div>
    @if (calendar.hasValue()) {
      @let view = calendar.value();
      <div
        class="calendar-region overflow-x-auto"
        [class.week]="narrow()"
        tabindex="0"
        role="region"
        aria-label="Abwesenheitskalender"
        (pointerdown)="pointerDown($event)"
        (pointerup)="pointerUp($event)"
        (pointercancel)="cancelSwipe()"
        (lostpointercapture)="cancelSwipe()"
      >
        <table class="cal" [attr.aria-label]="'Abwesenheiten ' + periodLabel()">
          <thead>
            <tr>
              <th class="n" scope="col">Mitarbeiter</th>
              @for (day of view.days; track day.date) {
                <th
                  class="d"
                  scope="col"
                  [class.we]="day.weekday > 5"
                  [class.hol]="!!day.holidayName"
                  [class.today]="day.date === today"
                  [attr.aria-current]="day.date === today ? 'date' : null"
                  [title]="day.holidayName || ''"
                >
                  {{ weekday(day.weekday) }}<b>{{ +day.date.slice(8) }}</b>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of view.rows; track row.employeeId) {
              <tr>
                <th class="n" scope="row">{{ row.name }}</th>
                @for (day of view.days; track day.date; let i = $index) {
                  <td
                    class="d"
                    [class.we]="day.weekday > 5"
                    [class.hol]="!!day.holidayName"
                    [class.off]="row.offDays[i]"
                    [class.today]="day.date === today"
                    [title]="day.holidayName || ''"
                  >
                    @if (row.offDays[i] && !row.cells[i]) {
                      <span class="sr-only">kein Arbeitstag laut Vertrag</span>
                    }
                    @if (row.cells[i]; as cell) {
                      <span
                        class="cal-absence"
                        [class.ap]="cell.status === 'APPROVED'"
                        [class.op]="cell.status === 'PENDING'"
                        [class.half]="cell.half"
                        [title]="cell.status === 'APPROVED' ? 'abwesend' : 'beantragt'"
                        role="img"
                        [attr.aria-label]="
                          (cell.status === 'APPROVED' ? 'abwesend' : 'beantragt') +
                          (cell.half ? ', halber Tag' : '')
                        "
                      ></span>
                    }
                  </td>
                }
              </tr>
            }
            @if (employee() && view.teamAbsentCounts; as counts) {
              <tr>
                <th class="n" scope="row">Im Team abwesend</th>
                @for (day of view.days; track day.date; let i = $index) {
                  <td
                    class="d"
                    [class.an]="(counts[i] ?? 0) > 0"
                    [class.we]="day.weekday > 5"
                    [class.hol]="!!day.holidayName"
                    [class.today]="day.date === today"
                    [title]="day.holidayName || ''"
                  >
                    {{ counts[i] || '' }}
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="cal-legend">
        @if (employee()) {
          <span><i class="an"></i>Zahl: Kollegen im Team abwesend</span>
        }
        <span><i class="ap"></i>genehmigt</span><span><i class="op"></i>beantragt</span>
        <span><i class="ap half"></i>halber Tag</span
        ><span><i class="hol"></i>Feiertag (Bayern)</span> <span><i class="we"></i>Wochenende</span
        ><span><i class="off"></i>kein Arbeitstag laut Vertrag</span>
      </div>
      @if (employee()) {
        <p class="mb-0 text-[13px] text-muted">
          Du siehst deine eigenen Tage und nur die Anzahl der Kollegen aus deinem Team mit
          genehmigter Abwesenheit. Namen, Gründe und offene Anträge sind nicht sichtbar.
        </p>
      }
    } @else if (calendar.error()) {
      <p class="err" role="alert">Der Kalender konnte nicht geladen werden.</p>
      <button class="btn" type="button" (click)="calendar.reload()">Kalender erneut laden</button>
    } @else {
      <p class="text-muted">Kalender wird geladen …</p>
    }
  `,
})
export class LeaveCalendar {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  protected readonly today = localDateInBerlin(new Date());
  protected readonly narrow = mediaQuery(NARROW);
  /**
   * Gewähltes Datum als stabiler Anker: Woche und Monat werden daraus abgeleitet, ein Wechsel der
   * Breite ändert ihn nicht (Review Design, Befund 5).
   */
  private readonly anchor = signal(this.today);
  protected readonly month = computed(() => this.anchor().slice(0, 7));
  protected readonly weekStart = computed(() => mondayOf(this.anchor()));
  protected readonly employee = computed(() => this.store.role() === 'EMPLOYEE');
  protected readonly calendar = resource({
    params: () => ({ month: this.month(), weekStart: this.narrow() ? this.weekStart() : null }),
    loader: async ({ params }) => {
      if (!params.weekStart) return this.api.leaveCalendar(params.month);
      const months = [
        ...new Set([params.weekStart.slice(0, 7), addDays(params.weekStart, 6).slice(0, 7)]),
      ];
      const views = await Promise.all(months.map((month) => this.api.leaveCalendar(month)));
      return weekView(params.weekStart, views);
    },
  });
  protected readonly periodLabel = computed(() => {
    const month = new Intl.DateTimeFormat('de-DE', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Berlin',
    }).format(
      // Wochenansicht: Monat des Montags.
      new Date(`${this.narrow() ? this.weekStart().slice(0, 7) : this.month()}-01T12:00:00Z`),
    );
    return this.narrow() ? `${month} · KW ${isoWeek(this.weekStart())}` : month;
  });
  protected readonly weekday = (day: number) => WEEKDAY_SHORT[day as IsoWeekday];
  private swipeStart: { x: number; y: number; pointerId: number } | null = null;

  protected move(direction: number): void {
    this.cancelSwipe();
    this.anchor.set(
      this.narrow()
        ? addDays(this.weekStart(), direction * 7)
        : `${addDays(`${this.month()}-01`, direction < 0 ? -1 : 32).slice(0, 7)}-01`,
    );
  }

  protected goToday(): void {
    this.cancelSwipe();
    this.anchor.set(this.today);
  }

  protected pointerDown(event: PointerEvent): void {
    this.cancelSwipe();
    if (!this.narrow() || event.button !== 0 || event.isPrimary === false) return;
    this.swipeStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  protected pointerUp(event: PointerEvent): void {
    const start = this.swipeStart;
    this.cancelSwipe();
    if (!this.narrow() || !start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) this.move(dx < 0 ? 1 : -1);
  }

  protected cancelSwipe(): void {
    this.swipeStart = null;
  }
}

/** Tagesindizes beziehen sich auf die jeweilige Monatsantwort, nie auf den Wochentag. */
function weekView(start: string, views: LeaveCalendarView[]): LeaveCalendarView {
  const dates = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const days = new Map(views.flatMap((view) => view.days.map((day) => [day.date, day] as const)));
  const rows = new Map<string, CalendarRow>();
  const counts = views.some((view) => view.teamAbsentCounts !== null) ? dates.map(() => 0) : null;
  for (const view of views) {
    const indices = dates.map((date) => view.days.findIndex((day) => day.date === date));
    for (const source of view.rows) {
      let row = rows.get(source.employeeId);
      if (!row) {
        row = {
          employeeId: source.employeeId,
          name: source.name,
          cells: dates.map(() => null),
          offDays: dates.map(() => false),
        };
        rows.set(source.employeeId, row);
      }
      indices.forEach((index, target) => {
        if (index < 0) return;
        row.cells[target] = source.cells[index] ?? null;
        row.offDays[target] = source.offDays[index] ?? false;
      });
    }
    indices.forEach((index, target) => {
      if (counts && index >= 0) counts[target] = view.teamAbsentCounts?.[index] ?? 0;
    });
  }
  return {
    month: start.slice(0, 7),
    days: dates.map(
      (date) => days.get(date) ?? { date, weekday: isoWeekday(date), holidayName: null },
    ),
    rows: [...rows.values()],
    teamAbsentCounts: counts,
  };
}
