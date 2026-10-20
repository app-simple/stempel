import {
  ForbiddenException,
  Inject,
  Injectable,
  NestMiddleware,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF-Schutz ergänzend zu SameSite=Lax: zustandsändernde Anfragen nur von der eigenen Oberfläche
 * (passender Origin-Header) und nur mit JSON.
 */
@Injectable()
export class OriginMiddleware implements NestMiddleware {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.headers.origin !== this.config.appOrigin) {
      throw new ForbiddenException('Anfrage von einer fremden Seite abgelehnt.');
    }
    // Auch Bodies ohne Content-Length (Transfer-Encoding: chunked) zählen.
    const hasBody =
      req.headers['transfer-encoding'] !== undefined ||
      Number(req.headers['content-length'] ?? 0) > 0;
    if (hasBody && !req.is('application/json')) {
      throw new UnsupportedMediaTypeException('Nur JSON wird angenommen.');
    }
    next();
  }
}
