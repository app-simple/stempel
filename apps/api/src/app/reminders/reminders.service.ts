import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  addDays,
  berlinInstant,
  eachDay,
  formatLocalDate,
  isoWeekday,
  type LocalDate,
  type PushDeviceView,
  type PushSubscriptionInput,
  type ReminderTodayView,
} from '@as/shared';
import {
  certificateDue,
  clockInReminderDue,
  isYouthOn,
  youthDayLimits,
  clockOutReminderDue,
  minijobRecordingDue,
  usualStart,
  type DayAbsence,
} from '@as/time-rules';
import type { Employee, EmploymentTerms, ReminderKind } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { RATE_LIMITS, RateLimitService } from '../auth/rate-limit.service';
import type { AuthUser } from '../common/auth-user';
import { Clock } from '../common/clock';
import { sha256Hex } from '../common/crypto';
import { fromLocalDate, toLocalDate } from '../common/dates';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { approvedAbsences } from '../leave/leave-context';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { holidaysBetween, termsAt } from '../time/time-context';
import { PushService, type PushPayload } from './push.service';
import { companySettings } from '../common/company-settings';

const RUN_EVERY_MS = 5 * 60_000;
const LEARN_DAYS = 56;
/** Höchstzahl der Push-Geräte je Person (Befund 7). */
const MAX_DEVICES = 10;
/** Tage zurück für die Minijob-Frist (Erinnerung am 5. bis 7. Tag). */
const MINIJOB_LOOKBACK = 8;

/** Neutrale Texte ohne personenbezogene Details (Spezifikation Phase 5, Abschnitte 6.2, 6.3). */
const TEXTS: Record<ReminderKind, (dates: LocalDate[]) => Omit<PushPayload, 'tag'>> = {
  CLOCK_IN: () => ({
    title: 'Zeit & Urlaub',
    body: 'Du hast heute noch nicht gestempelt',
    url: '/',
    mutable: true,
  }),
  CLOCK_OUT: () => ({
    title: 'Zeit & Urlaub',
    body: 'Du bist seit über 10 Stunden eingestempelt. Ausstempeln vergessen?',
    url: '/',
    mutable: false,
  }),
  MINIJOB_RECORDING: (dates) => ({
    title: 'Zeit & Urlaub',
    body: `Bitte trage deine Arbeitszeit vom ${dates.map(formatLocalDate).join(', ')} nach. Die Aufzeichnung muss bis zum 7. Tag erfolgen.`,
    url: '/zeiten',
    mutable: false,
  }),
  // Phase 7, Abschnitt 7: Vorwarnung für Jugendliche, nur an die Person.
  YOUTH_BREAK: () => ({
    title: 'Zeit & Urlaub',
    body: 'Bitte mache bald eine Pause.',
    url: '/',
    mutable: false,
  }),
  YOUTH_END: () => ({
    title: 'Zeit & Urlaub',
    body: 'Bitte denke an deinen Feierabend.',
    url: '/',
    mutable: false,
  }),
  // Phase 6, Abschnitt 6: neutral, ohne Art und Zeitraum.
  CERTIFICATE: () => ({
    title: 'Zeit & Urlaub',
    body: 'Bitte reiche deine Arbeitsunfähigkeitsbescheinigung ein.',
    url: '/urlaub',
    mutable: false,
  }),
};

type EmployeeWithTerms = Employee & { terms: EmploymentTerms[] };

/**
 * Erinnerungen (Spezifikation Phase 5): Lauf alle 5 Minuten im API-Prozess (Entscheidung 1). Vor dem
 * Versand wird die `ReminderLog`-Zeile angelegt; die Eindeutigkeit je Person, Tag, Art und Stufe
 * verhindert doppelte Sendungen auch bei mehreren Instanzen. Empfänger ist nur die Person selbst.
 */
@Injectable()
export class RemindersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Reminders');
  private timer: NodeJS.Timeout | null = null;
  /** Kein überlappender Lauf in diesem Prozess (Befund 6); über Instanzen hinweg schützt das Protokoll. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly push: PushService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.nodeEnv === 'test') return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.runOnce().catch((error: unknown) =>
        this.logger.error(
          `Lauf fehlgeschlagen: ${error instanceof Error ? error.name : 'unbekannt'}`,
        ),
      );
    }, RUN_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Ein Lauf; gibt die Anzahl der neu angelegten Erinnerungen zurück. */
  async runOnce(): Promise<number> {
    this.running = true;
    try {
      return await this.run();
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<number> {
    const today = this.clock.today();
    const people = await this.prisma.employee.findMany({
      where: {
        lockedAt: null,
        entryDate: { lte: fromLocalDate(today) },
        OR: [{ exitDate: null }, { exitDate: { gte: fromLocalDate(today) } }],
      },
      include: { terms: true },
    });
    const holidays = await holidaysBetween(this.prisma, addDays(today, -MINIJOB_LOOKBACK), today);
    const absences = await approvedAbsences(
      this.prisma,
      people.map((p) => p.id),
      addDays(today, -MINIJOB_LOOKBACK),
      today,
    );
    const settings = await companySettings(this.prisma);
    let created = 0;
    for (const employee of people) {
      const absent = absences.get(employee.id) ?? new Map();
      // Fehler bei einer Person brechen den Lauf für die übrigen nicht ab (Befund 8).
      try {
        created += await this.forPerson(
          employee,
          today,
          holidays.dates,
          absent,
          settings.reminderDefaultStart,
        );
      } catch (error) {
        this.logger.warn(
          `Erinnerung für eine Person fehlgeschlagen: ${error instanceof Error ? error.name : 'unbekannt'}`,
        );
      }
    }
    return created;
  }

  private async forPerson(
    employee: EmployeeWithTerms,
    today: LocalDate,
    holidays: ReadonlySet<LocalDate>,
    absent: ReadonlyMap<LocalDate, unknown>,
    defaultStart: string,
  ): Promise<number> {
    const now = this.clock.now();
    let created = 0;
    const logs = await this.prisma.reminderLog.findMany({
      where: {
        employeeId: employee.id,
        date: { gte: fromLocalDate(addDays(today, -MINIJOB_LOOKBACK)) },
      },
    });
    const log = (kind: ReminderKind, date: LocalDate, stage: number) =>
      logs.find((l) => l.kind === kind && toLocalDate(l.date) === date && l.stage === stage);

    // Einstempeln
    const clockIn = await this.clockInState(employee, today, holidays, absent, defaultStart);
    const stage1 = log('CLOCK_IN', today, 1);
    const inStage = clockInReminderDue({
      ...clockIn.input,
      stage1SentAt: stage1 ? (stage1.sentAt ?? stage1.createdAt) : null,
      stage2Sent: !!log('CLOCK_IN', today, 2),
    });
    if (inStage && (await this.deliver(employee, 'CLOCK_IN', today, inStage))) created++;

    // Ausstempeln vergessen
    const open = await this.prisma.timeEntry.findFirst({
      where: { employeeId: employee.id, endAt: null, voidedAt: null },
    });
    const sickOn = (date: LocalDate) => {
      const type = (absent.get(date) as DayAbsence | undefined)?.type;
      return type === 'SICK' || type === 'CHILD_SICK';
    };
    // Keine Erinnerung ans Ausstempeln an Krankheitstagen, weder am Buchungstag noch heute
    // (Spezifikation Phase 6, Abschnitt 5; Codex-Review Befund 4).
    if (open && !sickOn(toLocalDate(open.workDate)) && !sickOn(today)) {
      const date = toLocalDate(open.workDate);
      const out1 = log('CLOCK_OUT', date, 1);
      const outStage = clockOutReminderDue({
        now,
        openSince: open.startAt,
        stage1SentAt: out1 ? (out1.sentAt ?? out1.createdAt) : null,
        stage2Sent: !!log('CLOCK_OUT', date, 2),
      });
      if (outStage && (await this.deliver(employee, 'CLOCK_OUT', date, outStage))) created++;
    }

    // Minijob: Aufzeichnungsfrist (§ 17 Abs. 1 MiLoG)
    if (termsAt(employee.terms, today)?.type === 'MINIJOB') {
      const from = addDays(today, -MINIJOB_LOOKBACK);
      const entryDate = toLocalDate(employee.entryDate);
      const workDays = eachDay(from, addDays(today, -1)).filter((d) => {
        const terms = termsAt(employee.terms, d);
        return (
          d >= entryDate &&
          terms?.type === 'MINIJOB' &&
          terms.workDays.includes(isoWeekday(d)) &&
          !holidays.has(d) &&
          !absent.has(d)
        );
      });
      const recorded = await this.prisma.timeEntry.findMany({
        where: {
          employeeId: employee.id,
          voidedAt: null,
          workDate: { gte: fromLocalDate(from), lte: fromLocalDate(today) },
        },
        select: { workDate: true },
      });
      const due = minijobRecordingDue({
        today,
        workDays,
        recordedDates: new Set(recorded.map((r) => toLocalDate(r.workDate))),
        sent: new Set(),
      });
      // Eine gebündelte Erinnerung je Versandtag (Befund 4), nicht an Feiertagen und nicht bei
      // eigener Abwesenheit am Versandtag (Befund 5). Vertragsfreie Tage bleiben erlaubt, sonst
      // fiele die Frist von 7 Tagen bei wenigen Arbeitstagen oft ganz durch.
      if (due.length && !holidays.has(today) && !absent.has(today))
        if (
          await this.deliver(
            employee,
            'MINIJOB_RECORDING',
            today,
            1,
            due.map((d) => d.date),
          )
        )
          created++;
    }
    // Jugendliche: 15 Minuten vor der spätesten Pause bzw. dem spätesten Feierabend (Phase 7).
    if (open && !sickOn(today)) created += await this.youthReminders(employee, open, now, log);
    created += await this.certificateReminders(employee, today, defaultStart);
    return created;
  }

  private async youthReminders(
    employee: EmployeeWithTerms,
    open: { workDate: Date },
    now: Date,
    log: (kind: ReminderKind, date: LocalDate, stage: number) => unknown,
  ): Promise<number> {
    const day = toLocalDate(open.workDate);
    const birthDate = employee.birthDate ? toLocalDate(employee.birthDate) : null;
    if (!isYouthOn(birthDate, day)) return 0;
    const rows = await this.prisma.timeEntry.findMany({
      where: { employeeId: employee.id, voidedAt: null, workDate: open.workDate },
      include: { breaks: true },
    });
    const limits = youthDayLimits({
      workDate: day,
      entries: rows.map((r) => ({
        workDate: day,
        start: r.startAt,
        end: r.endAt,
        breaks: r.breaks.map((b) => ({ start: b.startAt, end: b.endAt })),
        source: r.source,
        recordedAt: r.recordedAt,
      })),
      now,
    });
    const soon = (at: Date) => now.getTime() >= at.getTime() - 15 * 60_000;
    let created = 0;
    if (limits.latestBreak && soon(limits.latestBreak) && !log('YOUTH_BREAK', day, 1))
      if (await this.deliver(employee, 'YOUTH_BREAK', day, 1)) created++;
    if (soon(limits.latestEnd) && !log('YOUTH_END', day, 1))
      if (await this.deliver(employee, 'YOUTH_END', day, 1)) created++;
    return created;
  }

  /**
   * AU fällig, aber nicht vermerkt (Spezifikation Phase 6, Abschnitt 6): einmal je Krankmeldung am
   * Fälligkeitstag bzw. beim ersten Lauf danach, frühestens zur Standardzeit; nur an die Person.
   */
  private async certificateReminders(
    employee: EmployeeWithTerms,
    today: LocalDate,
    defaultStart: string,
  ): Promise<number> {
    const start = berlinInstant(today, defaultStart);
    if (start && this.clock.now() < start) return 0;
    const leaves = await this.prisma.sickLeave.findMany({
      where: {
        employeeId: employee.id,
        kind: { in: ['SICK', 'CHILD_SICK'] },
        from: { lte: fromLocalDate(today) },
        to: { gte: fromLocalDate(addDays(today, -MINIJOB_LOOKBACK)) },
      },
    });
    if (!leaves.length) return 0;
    // Protokolle der Krankmeldungen laden (Datum = Beginn, kann vor dem Rückblick liegen).
    const sent = await this.prisma.reminderLog.findMany({
      where: {
        employeeId: employee.id,
        kind: 'CERTIFICATE',
        date: { in: leaves.map((l) => l.from) },
      },
      select: { date: true },
    });
    const logged = new Set(sent.map((r) => toLocalDate(r.date)));
    // Feiertage für den ganzen Berechnungszeitraum, damit die Fälligkeit stabil bleibt (Befund 5).
    const earliest = leaves.reduce((a, l) => (l.from < a ? l.from : a), leaves[0]!.from);
    const holidays = await holidaysBetween(this.prisma, toLocalDate(earliest), addDays(today, 14));
    let created = 0;
    for (const leave of leaves) {
      const from = toLocalDate(leave.from);
      const to = toLocalDate(leave.to);
      const due = certificateDue({
        kind: leave.kind === 'CHILD_SICK' ? 'CHILD_SICK' : 'SICK',
        from,
        to,
        fromDay1: employee.certificateFromDay1,
        workDays: (date) => termsAt(employee.terms, date)?.workDays ?? [],
        holidays: holidays.dates,
      });
      // Einmal je Krankmeldung: das Protokoll hängt am stabilen Beginn, nicht an der Fälligkeit.
      if (!due || due > today || logged.has(from)) continue;
      const needed = to < today ? to : today;
      const until = leave.certificateUntil ? toLocalDate(leave.certificateUntil) : null;
      if (until !== null && until >= needed) continue;
      if (await this.deliver(employee, 'CERTIFICATE', from, 1)) created++;
    }
    return created;
  }

  /** Eingaben für die Erinnerung ans Einstempeln; auch für das Banner. */
  private async clockInState(
    employee: EmployeeWithTerms,
    today: LocalDate,
    holidays: ReadonlySet<LocalDate>,
    absent: ReadonlyMap<LocalDate, unknown>,
    defaultStart: string,
  ) {
    const samples = await this.prisma.timeEntry.findMany({
      where: {
        employeeId: employee.id,
        workDate: { gte: fromLocalDate(addDays(today, -LEARN_DAYS)), lte: fromLocalDate(today) },
      },
      select: {
        workDate: true,
        startAt: true,
        source: true,
        voidedAt: true,
        endAt: true,
        _count: { select: { revisions: true } },
      },
    });
    const learned = usualStart(
      samples.map((s) => ({
        workDate: toLocalDate(s.workDate),
        start: s.startAt,
        // Korrigierte Stempelzeiten sind keine echten Stempelzeiten mehr (Befund 3).
        source: s._count.revisions > 0 ? ('MANUAL' as const) : s.source,
        voided: s.voidedAt !== null,
      })),
      today,
    );
    const terms = termsAt(employee.terms, today);
    const muted = await this.prisma.reminderLog.count({
      where: { employeeId: employee.id, date: fromLocalDate(today), kind: 'CLOCK_IN', muted: true },
    });
    return {
      learned,
      start: learned ?? defaultStart,
      input: {
        now: this.clock.now(),
        date: today,
        usualStart: learned,
        defaultStart,
        isWorkday: !!terms && terms.workDays.includes(isoWeekday(today)),
        holiday: holidays.has(today),
        absent: absent.has(today),
        hasEntry: samples.some((s) => toLocalDate(s.workDate) === today && s.voidedAt === null),
        muted: muted > 0,
      },
    };
  }

  /**
   * Erinnerung zustellen: zuerst die Protokollzeile beanspruchen (eindeutig), dann Push an alle Geräte;
   * ohne zugestelltes Push per E-Mail, wenn der Rückfall eingeschaltet ist (Entscheidung 5).
   * Abgelaufene Geräte (404/410) werden entfernt.
   */
  private async deliver(
    employee: Employee,
    kind: ReminderKind,
    date: LocalDate,
    stage: number,
    missingDates: LocalDate[] = [],
  ): Promise<boolean> {
    let logId: string;
    try {
      logId = (
        await this.prisma.reminderLog.create({
          data: { employeeId: employee.id, date: fromLocalDate(date), kind, stage },
        })
      ).id;
    } catch (error) {
      // Schon beansprucht (andere Instanz oder früherer Lauf); andere Fehler weiterreichen.
      if ((error as { code?: string }).code === 'P2002') return false;
      throw error;
    }
    const payload: PushPayload = {
      ...TEXTS[kind](missingDates.length ? missingDates : [date]),
      tag: kind,
    };
    let channel: 'PUSH' | 'EMAIL' | null = null;
    let activeDevices = 0;
    if (this.push.enabled) {
      const devices = await this.prisma.pushSubscription.findMany({
        where: { employeeId: employee.id },
      });
      for (const device of devices) {
        const result = await this.push.send(device, payload);
        // Idempotent und eigentümergebunden: Das Gerät kann parallel entfernt worden sein (Befund 8).
        if (result === 'gone') {
          await this.prisma.pushSubscription.deleteMany({
            where: { id: device.id, employeeId: employee.id },
          });
          continue;
        }
        activeDevices++;
        if (result === 'ok') {
          channel = 'PUSH';
          await this.prisma.pushSubscription.updateMany({
            where: { id: device.id, employeeId: employee.id },
            data: { lastSuccessAt: this.clock.now() },
          });
        }
      }
    }
    // E-Mail nur ohne aktives Gerät (Entscheidung 5, Befund 9); ein vorübergehender Push-Fehler
    // führt nicht zu einer zweiten Benachrichtigung per E-Mail.
    if (!channel && activeDevices === 0 && employee.reminderEmailFallback) {
      const sent = await this.mail
        .send({
          to: employee.loginEmail,
          subject: 'Erinnerung von Zeit & Urlaub',
          text: `${payload.body}.\n\n${this.config.appOrigin}${payload.url}`,
        })
        .then(
          () => true,
          () => false,
        );
      if (sent) channel = 'EMAIL';
    }
    await this.prisma.reminderLog.update({
      where: { id: logId },
      data: { channel, sentAt: channel ? this.clock.now() : null },
    });
    return true;
  }

  // ---------- API für die angemeldete Person ----------

  async today(user: AuthUser): Promise<ReminderTodayView> {
    const today = this.clock.today();
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id: user.id },
      include: { terms: true },
    });
    const holidays = await holidaysBetween(this.prisma, today, today);
    const absent =
      (await approvedAbsences(this.prisma, [user.id], today, today)).get(user.id) ?? new Map();
    const settings = await companySettings(this.prisma);
    const state = await this.clockInState(
      employee,
      today,
      holidays.dates,
      absent,
      settings.reminderDefaultStart,
    );
    const relevant =
      state.input.isWorkday && !state.input.holiday && !state.input.absent && !state.input.hasEntry;
    const open = await this.prisma.timeEntry.findFirst({
      where: { employeeId: user.id, endAt: null, voidedAt: null },
    });
    return {
      clockIn: relevant
        ? {
            due:
              clockInReminderDue({
                ...state.input,
                muted: false,
                stage1SentAt: null,
                stage2Sent: false,
              }) === 1 && !state.input.muted,
            start: state.start,
            learned: state.learned !== null,
            muted: state.input.muted,
          }
        : null,
      // Kein Ausstempel-Hinweis an Krankheitstagen (Codex-Review Phase 6, Befund 4).
      clockOutDue:
        !!open &&
        !['SICK', 'CHILD_SICK'].includes(
          String((absent.get(today) as DayAbsence | undefined)?.type),
        ) &&
        clockOutReminderDue({
          now: this.clock.now(),
          openSince: open.startAt,
          stage1SentAt: null,
          stage2Sent: false,
        }) === 1,
    };
  }

  /** „Heute nicht erinnern“ (idempotent). */
  async mute(user: AuthUser): Promise<void> {
    const today = fromLocalDate(this.clock.today());
    await this.prisma.reminderLog.upsert({
      where: {
        employeeId_date_kind_stage: {
          employeeId: user.id,
          date: today,
          kind: 'CLOCK_IN',
          stage: 0,
        },
      },
      create: { employeeId: user.id, date: today, kind: 'CLOCK_IN', stage: 0, muted: true },
      update: {},
    });
  }

  publicKey(): { publicKey: string | null } {
    return { publicKey: this.push.publicKey };
  }

  async devices(user: AuthUser): Promise<PushDeviceView[]> {
    const rows = await this.prisma.pushSubscription.findMany({
      where: { employeeId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      deviceName: r.deviceName,
      createdAt: r.createdAt.toISOString(),
      lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
      endpointHash: sha256Hex(r.endpoint),
    }));
  }

  /**
   * Gerät anmelden (Befunde 2 und 7): Ein Endpunkt einer anderen Person wird nur übernommen, wenn
   * auch die Schlüssel übereinstimmen (Besitz des Browsers, z. B. gemeinsam genutztes Gerät). Höchstens
   * zehn Geräte je Person; Anmeldungen sind je Person begrenzt.
   */
  async subscribe(user: AuthUser, input: PushSubscriptionInput): Promise<PushDeviceView[]> {
    await this.rateLimit.consume(RATE_LIMITS.pushSubscribePerUser, user.id);
    await this.prisma.$transaction(async (tx) => {
      // Sperren in fester Reihenfolge: erst der Endpunkt (gegen gleichzeitige Übernahme durch
      // verschiedene Personen), dann die Person (Gerätezahl). Sicherheits-Review im Hintergrund.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`push-endpoint:${input.endpoint}`}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`push:${user.id}`}, 0))`;
      const existing = await tx.pushSubscription.findUnique({
        where: { endpoint: input.endpoint },
      });
      if (
        existing &&
        existing.employeeId !== user.id &&
        (existing.p256dh !== input.keys.p256dh || existing.auth !== input.keys.auth)
      )
        throw new ConflictException('Dieses Gerät ist bereits für eine andere Person angemeldet.');
      if (!existing || existing.employeeId !== user.id) {
        const count = await tx.pushSubscription.count({ where: { employeeId: user.id } });
        if (count >= MAX_DEVICES)
          throw new ConflictException(
            `Es sind höchstens ${MAX_DEVICES} Geräte möglich. Bitte zuerst ein Gerät entfernen.`,
          );
      }
      await tx.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: {
          employeeId: user.id,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          deviceName: input.deviceName,
        },
        // Eigene Neuanmeldung: neue Schlüssel übernehmen; Übernahme nur mit identischen Schlüsseln (oben).
        update: {
          employeeId: user.id,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          deviceName: input.deviceName,
        },
      });
      await this.audit.record({ action: 'push.subscribe', actorId: user.id }, tx);
    });
    return this.devices(user);
  }

  async unsubscribe(user: AuthUser, id: string): Promise<void> {
    const { count } = await this.prisma.pushSubscription.deleteMany({
      where: { id, employeeId: user.id },
    });
    if (count !== 1) throw new NotFoundException('Gerät nicht gefunden.');
    await this.audit.record({ action: 'push.unsubscribe', actorId: user.id });
  }

  /** Testnachricht an die eigenen Geräte (für die Einrichtung). */
  async test(user: AuthUser): Promise<{ delivered: number }> {
    await this.rateLimit.consume(RATE_LIMITS.pushTestPerUser, user.id);
    const devices = await this.prisma.pushSubscription.findMany({ where: { employeeId: user.id } });
    let delivered = 0;
    for (const device of devices) {
      const result = await this.push.send(device, {
        title: 'Zeit & Urlaub',
        body: 'Benachrichtigungen funktionieren.',
        url: '/profil',
        tag: 'TEST',
        mutable: false,
      });
      if (result === 'ok') delivered++;
      if (result === 'gone')
        await this.prisma.pushSubscription.deleteMany({
          where: { id: device.id, employeeId: user.id },
        });
    }
    return { delivered };
  }

  async setEmailFallback(user: AuthUser, enabled: boolean): Promise<{ emailFallback: boolean }> {
    await this.prisma.employee.update({
      where: { id: user.id },
      data: { reminderEmailFallback: enabled },
    });
    return { emailFallback: enabled };
  }
}
