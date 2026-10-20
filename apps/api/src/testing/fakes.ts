import { createECDH, randomBytes } from 'node:crypto';
import type { LocalDate } from '@as/shared';
import { localDateInBerlin } from '@as/shared';
import { Clock } from '../app/common/clock';
import {
  PushService,
  type PushPayload,
  type PushResult,
  type PushTarget,
} from '../app/reminders/push.service';
import { MailService, type OutgoingMail } from '../app/mail/mail.service';

export class FakeClock extends Clock {
  private current = new Date('2026-10-12T08:00:00.000Z');

  override now(): Date {
    return new Date(this.current);
  }

  override today(): LocalDate {
    return localDateInBerlin(this.current);
  }

  set(iso: string): void {
    this.current = new Date(iso);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class FakeMailService extends MailService {
  readonly sent: OutgoingMail[] = [];

  async send(mail: OutgoingMail): Promise<void> {
    this.sent.push(mail);
  }

  /** Der Versand läuft nach der Antwort; einmal die Ereignisschleife durchlaufen lassen. */
  async flush(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  lastCodeFor(to: string): string {
    const mail = [...this.sent].reverse().find((m) => m.to === to);
    const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error('Keine Code-Mail gefunden.');
    return code;
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/** Push-Attrappe: merkt sich Sendungen; Ergebnis je Endpunkt einstellbar. */
export class FakePushService extends PushService {
  readonly sent: { endpoint: string; payload: PushPayload }[] = [];
  readonly results = new Map<string, PushResult>();
  enabledFlag = true;

  get enabled(): boolean {
    return this.enabledFlag;
  }

  get publicKey(): string | null {
    return this.enabledFlag ? 'test-public-key' : null;
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    const result = this.results.get(target.endpoint) ?? 'ok';
    if (result === 'ok') this.sent.push({ endpoint: target.endpoint, payload });
    return result;
  }
}

/** Gültige Push-Schlüssel eines Browsers für Tests (P-256-Punkt und 16-Byte-Geheimnis). */
export function testPushKeys(): { p256dh: string; auth: string } {
  const ecdh = createECDH('prime256v1');
  return {
    p256dh: ecdh.generateKeys().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}
