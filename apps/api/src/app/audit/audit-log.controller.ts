import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { AuditLogView } from '@as/shared';
import { Roles } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

/** Protokoll, nur für den Admin. Neueste Einträge zuerst, seitenweise über `before`. */
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles('ADMIN')
  async list(
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ): Promise<AuditLogView[]> {
    if (limit !== undefined && !/^\d{1,3}$/.test(limit)) {
      throw new BadRequestException('limit muss eine ganze Zahl von 1 bis 500 sein.');
    }
    const take = limit === undefined ? 100 : Number(limit);
    if (take < 1 || take > 500)
      throw new BadRequestException('limit muss eine ganze Zahl von 1 bis 500 sein.');
    if (before !== undefined && !/^\d{1,18}$/.test(before)) {
      throw new BadRequestException('Ungültiger Parameter before.');
    }
    const rows = await this.prisma.auditLog.findMany({
      where: before ? { id: { lt: BigInt(before) } } : {},
      orderBy: { id: 'desc' },
      take,
    });
    const actorIds = [
      ...new Set(rows.map((r) => r.actorId).filter((id): id is string => id !== null)),
    ];
    const actors = await this.prisma.employee.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true },
    });
    const names = new Map(actors.map((a) => [a.id, a.name]));
    return rows.map((r) => ({
      id: r.id.toString(),
      at: r.at.toISOString(),
      actorId: r.actorId,
      actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      details: r.details,
    }));
  }
}
