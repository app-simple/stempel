import { Controller, Get } from '@nestjs/common';
import type { LegalParameterView } from '@as/shared';
import { toLocalDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';

/** Gesetzliche Werte, für alle Angemeldeten lesbar. Änderungen in Phase 1 per Migration oder Seed. */
@Controller('legal-parameters')
export class LegalController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(): Promise<LegalParameterView[]> {
    const rows = await this.prisma.legalParameter.findMany({
      orderBy: [{ key: 'asc' }, { validFrom: 'asc' }],
    });
    return rows.map((r) => ({
      key: r.key,
      value: r.value,
      validFrom: toLocalDate(r.validFrom),
      source: r.source,
    }));
  }
}
