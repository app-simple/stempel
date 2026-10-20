import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ABSENCE_TYPE_LABELS,
  formatHalfDays,
  formatLocalDate,
  type AbsenceType,
  type LocalDate,
} from '@as/shared';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { MailService, type OutgoingMail } from '../mail/mail.service';

export interface LeaveMailFacts {
  employeeName: string;
  type: AbsenceType;
  from: LocalDate;
  to: LocalDate;
  halfDays: number;
}

export type LeaveMailKind =
  'REQUESTED' | 'CANCEL_REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'CANCEL_REJECTED';

/**
 * Benachrichtigungen zu Abwesenheiten (Spezifikation Phase 3, Entscheidung 13): nur Name, Art,
 * Zeitraum, Tage und Link. Notiz und Ablehnungsgrund stehen nur in der Anwendung. Der Versand ist
 * nachgelagert; ein Fehler bricht die Aktion nicht ab und wird ohne Adresse protokolliert.
 */
@Injectable()
export class LeaveMailService {
  private readonly logger = new Logger('LeaveMail');

  constructor(
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  send(recipients: readonly string[], kind: LeaveMailKind, facts: LeaveMailFacts): void {
    for (const to of new Set(recipients)) {
      void this.mail.send(this.compose(to, kind, facts)).catch(() => {
        this.logger.warn(`Benachrichtigung ${kind} nicht versendet.`);
      });
    }
  }

  /**
   * Sammelmeldung offener Anträge. Wartet auf den Versand und meldet, ob er an alle Empfänger ging,
   * damit der Aufrufer die Anträge bei einem Fehler für den nächsten Lauf freigeben kann.
   */
  async sendOverdue(
    recipients: readonly string[],
    items: readonly LeaveMailFacts[],
  ): Promise<boolean> {
    if (items.length === 0 || recipients.length === 0) return items.length === 0;
    const lines = items.map((f) => `- ${describe(f)}`);
    const results = await Promise.allSettled(
      [...new Set(recipients)].map((to) =>
        this.mail.send({
          to,
          subject: `${items.length === 1 ? 'Ein Antrag ist' : `${items.length} Anträge sind`} seit mehr als fünf Arbeitstagen offen`,
          text: [
            'Folgende Anträge sind seit mehr als fünf Arbeitstagen nicht entschieden:',
            '',
            ...lines,
            '',
            `Zur Entscheidung: ${this.config.appOrigin}/freigaben`,
          ].join('\n'),
        }),
      ),
    );
    const ok = results.every((r) => r.status === 'fulfilled');
    if (!ok) this.logger.warn('Meldung offener Anträge nicht an alle Empfänger versendet.');
    return ok;
  }

  private compose(to: string, kind: LeaveMailKind, facts: LeaveMailFacts): OutgoingMail {
    const what = describe(facts);
    const toDecide = `Zur Entscheidung: ${this.config.appOrigin}/freigaben`;
    const own = `Details: ${this.config.appOrigin}/urlaub`;
    switch (kind) {
      case 'REQUESTED':
        return {
          to,
          subject: `Neuer Antrag: ${facts.employeeName}`,
          text: `${what}\n\n${toDecide}`,
        };
      case 'CANCEL_REQUESTED':
        return {
          to,
          subject: `Stornierung erbeten: ${facts.employeeName}`,
          text: `${facts.employeeName} bittet um Stornierung:\n${what}\n\n${toDecide}`,
        };
      case 'APPROVED':
        return { to, subject: 'Dein Antrag ist genehmigt', text: `Genehmigt: ${what}\n\n${own}` };
      case 'REJECTED':
        return {
          to,
          subject: 'Dein Antrag ist abgelehnt',
          text: `Abgelehnt: ${what}\nDie Begründung steht in der Anwendung.\n\n${own}`,
        };
      case 'CANCELLED':
        return { to, subject: 'Dein Urlaub ist storniert', text: `Storniert: ${what}\n\n${own}` };
      case 'CANCEL_REJECTED':
        return {
          to,
          subject: 'Stornierung nicht bestätigt',
          text: `Die Stornierung wurde nicht bestätigt, die Abwesenheit bleibt bestehen: ${what}\n\n${own}`,
        };
    }
  }
}

function describe(f: LeaveMailFacts): string {
  const days = formatHalfDays(f.halfDays);
  const unit = f.halfDays === 2 ? 'Tag' : 'Tage';
  const range =
    f.from === f.to
      ? formatLocalDate(f.from)
      : `${formatLocalDate(f.from)} – ${formatLocalDate(f.to)}`;
  return `${f.employeeName}, ${ABSENCE_TYPE_LABELS[f.type]}, ${range}, ${days} ${unit}`;
}
