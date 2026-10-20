import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  /** Keine Codes, Tokens, Anmeldeadressen oder IP-Adressen. */
  details?: Prisma.InputJsonObject;
}

type Db = Pick<PrismaService, 'auditLog'>;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Schreibt einen Protokolleintrag, optional innerhalb einer laufenden Transaktion. */
  async record(entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? null,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        ...(entry.details ? { details: entry.details } : {}),
      },
    });
  }
}
