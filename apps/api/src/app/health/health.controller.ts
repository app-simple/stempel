import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators';

/** Für Liveness- und Readiness-Probes im Cluster, ohne Anmeldung. */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
