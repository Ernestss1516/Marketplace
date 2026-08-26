import { Controller, Get, Param, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators';
import { JwtAuthGuard } from '../../common/guards';
import { JwtUser } from '../auth/auth.types';
import { DataExportService } from './data-export.service';

/**
 * BORRADO DE CUENTAS C6 — LA DESCARGA (§7.3, paso 4).
 *
 * ── MOLDE EXACTO: `GET /billing/invoices/:id/pdf` ───────────────────────────
 *
 * Endpoint AUTENTICADO que baja el objeto de R2 y lo devuelve como
 * `StreamableFile`. Ni una URL pública ni una prefirmada: el ZIP vive bajo un
 * prefijo privado y **sólo existe detrás de esta ruta**, que revalida quién pide
 * qué en CADA descarga. Es la misma frase que ya está escrita en
 * `tickets.controller.ts` para los adjuntos, y por el mismo motivo — sólo que
 * aquí lo que hay dentro no es un adjunto, es la vida entera de una persona.
 *
 * ── CONTROLADOR PROPIO, Y NO UNA RUTA BAJO `/users/me` ──────────────────────
 *
 * Porque hay DOS sujetos legítimos: el dueño y un ADMIN (§7.4). Colgarla de
 * `/users/me` obligaría a duplicar la ruta en `/admin` —dos endpoints sirviendo
 * el mismo fichero con dos comprobaciones que pueden divergir— y ya sabemos cómo
 * acaba eso. Una ruta, una comprobación, en `DataExportService.getExportFile`.
 */
@ApiTags('Exportación de datos')
@ApiBearerAuth('access-token')
@Controller('exports')
export class DataExportController {
  constructor(private readonly dataExport: DataExportService) {}

  @Get(':id/download')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Descargar el ZIP de una exportación propia (o cualquiera, si ADMIN)' })
  @ApiParam({ name: 'id', description: 'ID de la exportación' })
  @ApiResponse({ status: 200, description: 'El ZIP' })
  @ApiResponse({ status: 403, description: 'Esta exportación no es tuya' })
  @ApiResponse({ status: 404, description: 'No existe, aún no está lista, falló o ha caducado' })
  async download(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.dataExport.getExportFile(
      { userId: user.userId, role: user.role },
      id,
    );
    return new StreamableFile(buffer, {
      type: 'application/zip',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
