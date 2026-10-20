import { LucideCoffee, LucideLogIn, LucideLogOut } from '@lucide/angular';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  minijobEquationHolds,
  DAY_ABSENCE_LABELS,
  formatHalfDays,
  formatEuro,
  formatHoursMinutes,
  formatLocalDate,
  isoWeek,
  isoWeekday,
  localDateInBerlin,
  WEEKDAY_SHORT,
  type ClockState,
  type MinijobMonthView,
} from '@as/shared';
import { ApiError, ApiService } from '../../core/api.service';
import { HoursMinutesPipe } from '../../core/format.pipes';
import { SessionStore } from '../../core/session.store';
import { ToastService } from '../../core/toast.service';
import { SickReport } from '../sick/sick-report';
import { SickActions } from '../sick/sick-list';
import { PageHead, RuleMessages } from '../../shared-ui';

const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];
const MINIJOB_TEXT = {
  ok: 'Im Rahmen.',
  warn: 'Über 90 % der Grenze.',
  crit: 'Grenze überschritten. Nur gelegentlich und unvorhersehbar zulässig, sonst endet der Minijob-Status.',
} as const;

function nowHm(): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

function signed(minutes: number): string {
  return `${minutes > 0 ? '+' : ''}${formatHoursMinutes(minutes)}`;
}

/** „Heute“ wie im Prototyp: Stempeluhr, Woche bzw. Minijob-Monat, Hinweise, Team heute für Vorgesetzte. */
@Component({
  selector: 'app-home-page',
  imports: [
    SickReport,
    SickActions,
    PageHead,
    RouterLink,
    RuleMessages,
    HoursMinutesPipe,
    LucideLogIn,
    LucideLogOut,
    LucideCoffee,
  ],
  template: `
    <app-page-head [heading]="'Guten Tag, ' + store.firstName()" [lead]="dateLine()" />

    <app-sick-report
      [currentDay]="today.hasValue() ? today.value() : undefined"
      (saved)="sickChanged()"
    />
    @if (missingCertificate()) {
      <p class="hint" role="status">Bitte reiche deine Arbeitsunfähigkeitsbescheinigung ein.</p>
    }
    @if (sickToday.error() || ownSick.error()) {
      <p class="err" role="alert" tabindex="-1" data-sick-error>{{ sickError() }}</p>
      <button type="button" class="btn" (click)="sickToday.reload(); ownSick.reload()">
        Krankmeldungen erneut laden
      </button>
    }
    @if (skewMinutes() !== null) {
      <p class="hint m-0" role="status">
        Die Uhr dieses Geräts weicht um etwa {{ skewMinutes() }} Minuten von der Serverzeit ab.
        Gebucht wird immer die Serverzeit.
      </p>
    }

    @if (me.hasValue() && me.value().passkeyCount === 0) {
      <section class="card border-accent">
        <h2>Schneller anmelden mit Passkey</h2>
        <p class="m-0">
          Mit einem Passkey meldest du dich per Fingerabdruck, Gesicht oder Geräte-PIN an, ohne auf
          einen Code zu warten.
        </p>
        <div><a routerLink="/profil" class="btn btn-primary no-underline">Passkey anlegen</a></div>
      </section>
    }

    @if (reminders.hasValue()) {
      @let reminder = reminders.value();
      @if (reminder.clockIn?.due && !reminder.clockIn.muted) {
        <section class="card border-accent" data-reminder>
          <div class="lbl">Erinnerung · kommt auch als Benachrichtigung</div>
          <div>
            <b>Du hast heute noch nicht gestempelt.</b>
            <p class="m-0 text-sm">
              @if (reminder.clockIn.learned) {
                {{ reminderWeekday() }} beginnst du meist gegen {{ reminder.clockIn.start }} Uhr.
                Das leitet das Tool aus deinen bisherigen Stempelzeiten ab.
              } @else {
                Erinnert wird ab {{ reminder.clockIn.start }} Uhr plus 15 Minuten (Standardzeit).
              }
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-primary" type="button" [disabled]="busy()" (click)="act('in')">
              Jetzt stempeln
            </button>
            <a class="btn" routerLink="/zeiten">Bin schon länger da: nachtragen</a>
            <button class="btn" type="button" [disabled]="busy()" (click)="mute()">
              Heute nicht erinnern
            </button>
          </div>
        </section>
      }
      @if (reminder.clockOutDue) {
        <section class="card" data-reminder>
          <p class="hint m-0">Du bist seit über 10 Stunden eingestempelt. Ausstempeln vergessen?</p>
          <div>
            <button
              class="btn"
              type="button"
              aria-label="Gehen – Erinnerung ans Ausstempeln"
              [disabled]="busy()"
              (click)="act('out')"
            >
              Gehen
            </button>
          </div>
        </section>
      }
    }

    @if (today.hasValue()) {
      @let t = today.value();
      <div
        class="grid gap-5"
        style="grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr))"
      >
        <section class="card">
          @if (currentSick(); as sick) {
            <div tabindex="-1" data-sick-status>
              <h2>Heute krankgemeldet bis {{ date(sick.to) }}</h2>
              <app-sick-actions [sick]="sick" [today]="t.date" (saved)="sickChanged()" />
              @if (!showClock()) {
                <button type="button" class="btn" (click)="revealClock()">Trotzdem stempeln</button>
              }
            </div>
          }
          @if (!currentSick() || showClock()) {
            <h2>Stempeluhr</h2>
            @if (t.youthLimits; as limits) {
              <div class="hint m-0" role="status">
                <div>Heute spätestens um {{ limits.latestEnd }} Uhr Feierabend</div>
                @if (limits.latestBreak) {
                  <div>Pause spätestens um {{ limits.latestBreak }} Uhr</div>
                }
              </div>
            }
            <div
              class="font-mono text-[clamp(40px,9vw,60px)] leading-none font-medium tracking-[-0.02em] tabular-nums"
              aria-hidden="true"
            >
              {{ clock() }}
            </div>
            <div>
              <b data-testid="clock-status">{{ statusText() }}</b>
              <div class="text-[13px] text-muted">
                Heute gearbeitet: <span class="font-mono">{{ worked() | hm }}</span> Std.
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              @switch (t.state) {
                @case ('OUT') {
                  <button
                    type="button"
                    class="btn btn-primary btn-big"
                    data-clock-action
                    [disabled]="busy()"
                    (click)="act('in')"
                  >
                    <svg lucideLogIn [size]="20" aria-hidden="true"></svg>
                    Kommen
                  </button>
                }
                @case ('IN') {
                  <button
                    type="button"
                    class="btn btn-big"
                    data-clock-action
                    [disabled]="busy()"
                    (click)="act('break-start')"
                  >
                    <svg lucideCoffee [size]="20" aria-hidden="true"></svg>
                    Pause beginnen
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary btn-big"
                    data-clock-action
                    [disabled]="busy()"
                    (click)="act('out')"
                  >
                    <svg lucideLogOut [size]="20" aria-hidden="true"></svg>
                    Gehen
                  </button>
                }
                @case ('PAUSE') {
                  <button
                    type="button"
                    class="btn btn-primary btn-big"
                    data-clock-action
                    [disabled]="busy()"
                    (click)="act('break-end')"
                  >
                    <svg lucideCoffee [size]="20" aria-hidden="true"></svg>
                    Pause beenden
                  </button>
                }
              }
            </div>
            @if (error(); as message) {
              <p class="err m-0" role="alert">{{ message }}</p>
            }
            <p class="m-0 text-[13px] text-muted">
              Vergessen zu stempeln? Unter <a routerLink="/zeiten">„Zeiten“</a> lässt sich ein Tag
              mit Begründung nachtragen.
            </p>
          }
        </section>

        <section class="card">
          @if (t.minijob; as m) {
            <h2>Mein Monat</h2>
            <div class="flex flex-col gap-1.5" data-testid="minijob-meter">
              <div class="flex flex-wrap justify-between gap-2 text-[13px]">
                <span
                  >{{ monthName(m) }}: <span class="font-mono">{{ m.workMinutes | hm }}</span> Std.
                  @if (equation(m)) {
                    × {{ euro(m.hourlyWageCents) }} =
                    <b class="font-mono">{{ euro(m.earningsCents) }}</b>
                  } @else {
                    · Verdienst <b class="font-mono">{{ euro(m.earningsCents) }}</b> mit dem jeweils
                    geltenden Stundenlohn
                  }
                </span>
                <span class="text-muted">Grenze {{ euro(m.limitCents) }}</span>
              </div>
              <div class="h-2.5 overflow-hidden rounded-full bg-surface-2">
                <i
                  class="block h-full rounded-full"
                  [class.bg-ok]="m.level === 'ok'"
                  [class.bg-warn]="m.level === 'warn'"
                  [class.bg-crit]="m.level === 'crit'"
                  [style.width.%]="percent(m)"
                ></i>
              </div>
              <div class="text-[13px]">
                <span class="pill" [class]="'lv-' + m.level">{{ percentRounded(m) }} %</span
                >{{ minijobText(m) }}
              </div>
            </div>
          } @else {
            <h2>Meine Woche</h2>
            <div class="tiles">
              <div class="tile">
                <small class="lbl">Ist</small><b>{{ t.week.workMinutes | hm }}</b>
              </div>
              <div class="tile">
                <small class="lbl">Soll</small><b>{{ t.week.targetMinutes | hm }}</b>
              </div>
              <div class="tile">
                <small class="lbl">Saldo bis gestern</small
                ><b [class.text-crit]="(t.week.balanceUntilYesterday ?? 0) < 0">{{
                  signed(t.week.balanceUntilYesterday ?? 0)
                }}</b>
              </div>
              @if (t.overtime; as o) {
                <div class="tile">
                  <small class="lbl">Überstundenkonto</small
                  ><b [class.text-crit]="o.balanceMinutes < 0">{{ signed(o.balanceMinutes) }}</b>
                </div>
              }
            </div>
          }
          @if (leaveAccount.hasValue() && !leaveAccount.error()) {
            @let account = leaveAccount.value();
            <div class="tiles">
              <div class="tile">
                <small class="lbl">Resturlaub {{ account.year }}</small>
                <b [class.text-crit]="account.rest < 0">{{ halfDays(account.rest) }}</b>
              </div>
              <div class="tile">
                <small class="lbl">Beantragt</small><b>{{ halfDays(account.pending) }}</b>
              </div>
            </div>
          }
          @if (t.recentFlags.length) {
            <div>
              <div class="lbl mb-1.5">Hinweise der letzten 14 Tage</div>
              @for (day of t.recentFlags; track day.date) {
                <div class="text-[13px]">
                  {{ dayLabel(day.date) }} <app-rule-messages [messages]="day.flags" />
                </div>
              }
            </div>
          } @else {
            <div class="text-[13px] text-muted">Keine Hinweise in den letzten 14 Tagen.</div>
          }
        </section>
      </div>
    } @else if (today.error()) {
      <p class="err m-0" role="alert">Die Stempeluhr konnte nicht geladen werden.</p>
      <div>
        <button type="button" class="btn btn-sm" (click)="today.reload()">Erneut laden</button>
      </div>
    } @else {
      <p class="m-0 text-muted">Wird geladen …</p>
    }

    @if (isLead()) {
      <section class="card">
        <h2>Team heute</h2>
        @if (team.hasValue()) {
          <div class="overflow-x-auto">
            <table class="data-table">
              <tbody>
                @for (row of team.value(); track row.employeeId) {
                  <tr>
                    <td>
                      {{ row.name }}
                      @if (row.jobTitle) {
                        <div class="text-[13px] text-muted">{{ row.jobTitle }}</div>
                      }
                    </td>
                    <td>
                      @switch (row.presence) {
                        @case ('PRESENT') {
                          <span class="pill lv-ok">anwesend seit {{ row.since }}</span>
                        }
                        @case ('PAUSE') {
                          <span class="pill lv-info">Pause seit {{ row.since }}</span>
                        }
                        @case ('SICK') {
                          <span class="pill lv-mute">krank</span>
                        }
                        @case ('ABSENT') {
                          <span class="pill lv-mute">abwesend</span>
                        }
                        @case ('LEFT') {
                          <span class="pill lv-mute">gegangen</span>
                        }
                        @case ('NOT_WORKDAY') {
                          <span class="text-[13px] text-muted">kein Arbeitstag</span>
                        }
                        @case ('MISSING') {
                          <span class="pill lv-warn">noch nicht gestempelt</span>
                        }
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td class="text-muted">Niemand im Team.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (team.error()) {
          <p class="err m-0" role="alert">Das Team konnte nicht geladen werden.</p>
        }
        <p class="m-0 text-[13px] text-muted">
          Diese Liste sehen nur Vorgesetzte für ihr eigenes Team und der Admin. Mitarbeiter sehen
          keine Stempeldaten von Kollegen.
        </p>
      </section>
    }
  `,
})
export class HomePage {
  protected readonly store = inject(SessionStore);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  protected readonly reminders = resource({ loader: () => this.api.reminderToday() });
  protected readonly today = resource({ loader: () => this.api.today() });
  protected readonly date = formatLocalDate;
  protected readonly showClock = signal(false);
  private readonly focusAfterSickChange = signal(false);
  private readonly sickDate = computed(() =>
    this.today.hasValue() ? this.today.value().date : undefined,
  );
  protected readonly sickToday = resource({
    params: () => {
      const date = this.sickDate();
      const employeeId = this.store.session()?.id;
      return date && employeeId ? { employeeId, from: date, to: date } : undefined;
    },
    loader: ({ params }) => this.api.sickLeaves(params),
  });
  protected readonly ownSick = resource({
    params: () => this.store.session()?.id,
    loader: ({ params }) => this.api.sickLeaves({ employeeId: params }),
  });
  protected readonly currentSick = computed(() =>
    this.sickToday.hasValue() ? this.sickToday.value()[0] : undefined,
  );
  protected readonly missingCertificate = computed(
    () => this.ownSick.hasValue() && this.ownSick.value().some((row) => row.certificateMissing),
  );
  protected sickError(): string {
    const error = this.sickToday.error() ?? this.ownSick.error();
    return error instanceof ApiError
      ? error.message
      : 'Deine Krankmeldungen konnten nicht geladen werden.';
  }
  protected sickChanged(): void {
    this.sickToday.reload();
    this.ownSick.reload();
    this.today.reload();
    this.reminders.reload();
    this.leaveAccount.reload();
    if (this.isLead()) this.team.reload();
    this.showClock.set(false);
    this.focusAfterSickChange.set(true);
  }
  protected revealClock(): void {
    this.showClock.set(true);
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('[data-clock-action]')?.focus(),
      { injector: this.injector },
    );
  }
  private readonly leaveYear = computed(() =>
    this.today.hasValue() ? Number(this.today.value().date.slice(0, 4)) : undefined,
  );
  protected readonly leaveAccount = resource({
    params: this.leaveYear,
    loader: ({ params }) => this.api.leaveAccount(params),
  });
  protected readonly halfDays = formatHalfDays;
  protected readonly me = resource({ loader: () => this.api.me() });
  protected readonly isLead = computed(() => this.store.hasRole('LEAD', 'ADMIN'));
  protected readonly team = resource({
    params: () => (this.isLead() ? true : undefined),
    loader: () => this.api.teamToday(),
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly clock = signal(nowHm());
  /**
   * Empfangszeitpunkt des aktuellen Stands von „Heute“, neu bei jedem Laden; damit tickt die Arbeitszeit
   * ohne Doppelzählung weiter (Codex-Review Web Phase 2, Befund 3).
   */
  private readonly loadedAt = linkedSignal({
    source: () => this.today.value(),
    computation: () => Date.now(),
  });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly tick = signal(Date.now());

  protected readonly reminderWeekday = computed(
    () =>
      new Intl.DateTimeFormat('de-DE', { weekday: 'long', timeZone: 'Europe/Berlin' })
        .format(new Date(this.tick()))
        .toLocaleLowerCase('de-DE') + 's',
  );

  protected readonly dateLine = computed(() => {
    const date = localDateInBerlin(new Date(this.tick()));
    return `${WEEKDAY_SHORT[isoWeekday(date)]} ${formatLocalDate(date)}, Kalenderwoche ${isoWeek(date)}`;
  });

  protected readonly skewMinutes = computed(() => {
    if (!this.today.hasValue()) return null;
    const skew = Math.round(
      Math.abs(new Date(this.today.value().serverTime).getTime() - this.loadedAt()) / 60_000,
    );
    return skew >= 2 ? skew : null;
  });

  protected readonly worked = computed(() => {
    if (!this.today.hasValue()) return 0;
    const t = this.today.value();
    const running = t.state === 'IN' ? Math.floor((this.tick() - this.loadedAt()) / 60_000) : 0;
    return t.workedMinutes + Math.max(0, running);
  });

  protected readonly statusText = computed(() => {
    if (!this.today.hasValue()) return '';
    const t = this.today.value();
    const texts: Record<ClockState, string> = {
      OUT: t.entries.some((e) => e.end && !e.voided)
        ? `Erfasst: ${t.entries
            .filter((e) => !e.voided)
            .map((e) => `${e.startLocal}–${e.endLocal ?? '…'}`)
            .join(', ')} Uhr`
        : t.absence
          ? `Heute: ${DAY_ABSENCE_LABELS[t.absence.type]}${t.absence.half ? ' (halber Tag)' : ''}`
          : t.isWorkday
            ? 'Noch nicht gestempelt.'
            : 'Heute ist kein Arbeitstag laut Vertrag.',
      IN: `Anwesend seit ${t.since} Uhr`,
      PAUSE: `Pause seit ${t.since} Uhr`,
    };
    return texts[t.state];
  });

  constructor() {
    effect(() => {
      if (!this.focusAfterSickChange() || this.sickToday.isLoading() || this.today.isLoading())
        return;
      this.focusAfterSickChange.set(false);
      afterNextRender(
        () =>
          this.host.nativeElement
            .querySelector<HTMLElement>(
              '[data-sick-status], [data-clock-action], [data-sick-error]',
            )
            ?.focus(),
        { injector: this.injector },
      );
    });
    let day = localDateInBerlin(new Date());
    let ticks = 0;
    const timer = setInterval(() => {
      this.clock.set(nowHm());
      this.tick.set(Date.now());
      // Erinnerungen werden auch bei geöffneter Seite fällig: alle fünf Minuten neu laden (Befund 2).
      if (++ticks % 15 === 0) {
        this.reminders.reload();
        // AU-Banner: Fälligkeit kann bei geöffneter Seite eintreten (Review Web Phase 6, Befund 2).
        this.ownSick.reload();
      }
      // Über Mitternacht die Tagesdaten neu laden (Befund 4).
      const current = localDateInBerlin(new Date());
      if (current !== day) {
        day = current;
        this.today.reload();
        this.reminders.reload();
        this.ownSick.reload();
        if (this.isLead()) this.team.reload();
      }
    }, 20_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        this.reminders.reload();
        this.ownSick.reload();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  protected async act(action: 'in' | 'break-start' | 'break-end' | 'out'): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.api.clock(action);
      this.today.set(result.today);
      this.reminders.reload();
      this.tick.set(Date.now());
      if (action === 'in') this.toast.show(`Gekommen um ${result.today.since} Uhr.`);
      if (action === 'out') {
        // Die geschlossene Buchung kann zum Vortag gehören (Nachtschicht, Befund 5).
        const closed = result.closed;
        const hints = result.flags.filter((f) => f.level !== 'info');
        this.toast.show(
          `Gegangen um ${closed?.endLocal ?? nowHm()} Uhr. Arbeitszeit ${formatHoursMinutes(closed?.workMinutes ?? 0)} Std.` +
            (hints.length
              ? ` Hinweis: ${hints.map((f) => `${f.text} (${f.paragraph ?? ''})`).join('; ')}`
              : ''),
        );
      }
      if (this.isLead()) this.team.reload();
      // Der gedrückte Button verschwindet; Fokus auf die nächste Stempelaktion (Befund 7).
      afterNextRender(
        () =>
          this.host.nativeElement.querySelector<HTMLButtonElement>('[data-clock-action]')?.focus(),
        { injector: this.injector },
      );
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Die Buchung ist fehlgeschlagen.');
      this.today.reload();
    } finally {
      this.busy.set(false);
    }
  }

  protected async mute(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.muteReminders();
      // Nur die Einstempel-Erinnerung ist stumm; ein fälliger Ausstempel-Hinweis bleibt (Befund 3).
      if (this.reminders.hasValue())
        this.reminders.set({ ...this.reminders.value(), clockIn: null });
      this.toast.show('Für heute keine weitere Erinnerung.');
      afterNextRender(
        () =>
          this.host.nativeElement.querySelector<HTMLButtonElement>('[data-clock-action]')?.focus(),
        { injector: this.injector },
      );
    } catch (error) {
      this.error.set(
        error instanceof ApiError
          ? error.message
          : 'Die Erinnerung konnte nicht ausgeschaltet werden.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected dayLabel(date: string): string {
    return `${WEEKDAY_SHORT[isoWeekday(date)]} ${formatLocalDate(date).slice(0, 6)}`;
  }

  protected signed = signed;
  protected euro = formatEuro;
  protected readonly equation = minijobEquationHolds;
  protected monthName(m: MinijobMonthView): string {
    return MONTHS[Number(m.month.slice(5)) - 1] ?? m.month;
  }
  protected percent(m: MinijobMonthView): number {
    return Math.min(100, Math.round(m.ratio * 100));
  }
  protected percentRounded(m: MinijobMonthView): number {
    return Math.round(m.ratio * 100);
  }
  protected minijobText(m: MinijobMonthView): string {
    return MINIJOB_TEXT[m.level];
  }
}
