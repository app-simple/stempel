import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
  StreamableFile,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { ExportsService, type ExportFile } from './exports.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function file(f: ExportFile): StreamableFile {
  return new StreamableFile(f.body, {
    type: f.contentType,
    disposition: `attachment; filename="${f.fileName}"`,
    length: f.body.length,
  });
}

/** Export der Nachweise (Spezifikation Phase 4, Entscheidungen 4 und 5). */
@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('time')
  @Header('Cache-Control', 'no-store')
  async time(
    @CurrentUser() user: AuthUser,
    @Query('month') month?: string,
    @Query('format') format?: string,
    @Query('employeeId') employeeId?: string,
  ): Promise<StreamableFile> {
    if (format !== 'pdf' && format !== 'csv')
      throw new BadRequestException('Bitte das Format pdf oder csv angeben.');
    const id = employeeId ?? user.id;
    if (!UUID.test(id)) throw new BadRequestException('Ungültige employeeId.');
    return file(await this.exports.personMonth(user, id, month ?? '', format));
  }

  @Get('month')
  @Roles('ADMIN')
  @Header('Cache-Control', 'no-store')
  async month(
    @CurrentUser() user: AuthUser,
    @Query('month') month?: string,
  ): Promise<StreamableFile> {
    return file(await this.exports.allMonth(user, month ?? ''));
  }
}
