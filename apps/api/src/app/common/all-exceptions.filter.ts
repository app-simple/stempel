import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';

/**
 * Unerwartete Fehler (z. B. von Prisma) enthalten oft Nutzdaten wie Anmeldeadressen in der Meldung.
 * Ins Log kommen deshalb nur Fehlertyp und Fehlercode, nie die Meldung (CLAUDE.md: keine personenbezogenen
 * Daten in Logs). HTTP-Fehler der Anwendung behandelt Nest wie gewohnt.
 */
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('Fehler');

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) {
      super.catch(exception, host);
      return;
    }
    const name = exception instanceof Error ? exception.name : typeof exception;
    const code =
      typeof (exception as { code?: unknown })?.code === 'string'
        ? ` ${(exception as { code: string }).code}`
        : '';
    this.logger.error(`Unerwarteter Fehler: ${name}${code}`);
    const res = host.switchToHttp().getResponse<Response>();
    if (!res.headersSent) {
      res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ statusCode: 500, message: 'Interner Fehler. Bitte später erneut versuchen.' });
    }
  }
}
