import { Inject, Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Pfad, den ein Klick öffnet. */
  url: string;
  /** Gleiche Art ersetzt eine ältere Benachrichtigung. */
  tag: string;
  /** „Heute nicht erinnern“ anbieten. */
  mutable: boolean;
}

/** Ergebnis je Gerät: zugestellt, Anmeldung abgelaufen (404/410) oder anderer Fehler. */
export type PushResult = 'ok' | 'gone' | 'error';

/** Versand von Web-Push-Nachrichten. In Tests durch eine Attrappe ersetzt. */
export abstract class PushService {
  abstract get enabled(): boolean;
  abstract get publicKey(): string | null;
  abstract send(target: PushTarget, payload: PushPayload): Promise<PushResult>;
}

/**
 * Web Push mit VAPID (Spezifikation Phase 5, Entscheidung 2): Die Nachricht ist Ende-zu-Ende
 * verschlüsselt und enthält nur neutrale Texte. Endpunkte und Schlüssel erscheinen nie im Log.
 */
@Injectable()
export class WebPushService extends PushService {
  private readonly logger = new Logger('Push');

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
    if (config.vapid)
      webpush.setVapidDetails(
        config.vapid.subject,
        config.vapid.publicKey,
        config.vapid.privateKey,
      );
  }

  get enabled(): boolean {
    return this.config.vapid !== null;
  }

  get publicKey(): string | null {
    return this.config.vapid?.publicKey ?? null;
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    if (!this.config.vapid) return 'error';
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        // Zeitgrenze für die HTTP-Anfrage (Befund 6); TTL gilt nur beim Push-Dienst.
        { TTL: 60 * 60, urgency: 'normal', timeout: 10_000 },
      );
      return 'ok';
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      this.logger.warn(`Push nicht zugestellt (${status ?? 'ohne Status'}).`);
      return 'error';
    }
  }
}
