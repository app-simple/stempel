import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

/** Versand von E-Mails. In Tests durch eine Attrappe ersetzt. */
export abstract class MailService {
  abstract send(mail: OutgoingMail): Promise<void>;
}

@Injectable()
export class SmtpMailService extends MailService {
  private readonly logger = new Logger('Mail');
  private readonly transport: Transporter;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
    const { host, port, secure, user, password } = config.smtp;
    this.transport = createTransport({
      host,
      port,
      secure,
      ...(user && password ? { auth: { user, pass: password } } : {}),
    });
  }

  async send(mail: OutgoingMail): Promise<void> {
    try {
      await this.transport.sendMail({ from: this.config.smtp.from, ...mail });
    } catch (error) {
      // Keine Adresse im Log, nur die Art des Fehlers.
      this.logger.error(
        `Versand fehlgeschlagen: ${error instanceof Error ? error.name : 'unbekannt'}`,
      );
      throw error;
    }
  }
}

export function loginCodeMail(to: string, code: string): OutgoingMail {
  return {
    to,
    subject: 'Dein Anmeldecode für Zeit & Urlaub',
    text: [
      `Dein Anmeldecode lautet: ${code}`,
      '',
      'Er ist 10 Minuten gültig und kann einmal verwendet werden.',
      'Wenn du keinen Code angefordert hast, kannst du diese E-Mail ignorieren.',
    ].join('\n'),
  };
}
