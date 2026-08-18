import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Put,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, MinRole } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { AdminInvoicingService } from './admin-invoicing.service';
import { ListAdminInvoicesDto } from './dto/list-admin-invoices.dto';
import { UpdateFiscalIssuerDto } from './dto/update-fiscal-issuer.dto';

/**
 * Panel admin de facturas (RF.13 R5). ADMIN-only. Lectura de TODAS las facturas
 * (de todos los usuarios) + configuración del emisor fiscal. El admin puede
 * descargar cualquier factura (contraste con el owner-scope del usuario en R3).
 */
@ApiTags('Admin — Invoicing')
@ApiBearerAuth('access-token')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.ADMIN)
export class AdminInvoicingController {
  constructor(private readonly admin: AdminInvoicingService) {}

  @Get('invoices')
  listInvoices(@Query() query: ListAdminInvoicesDto) {
    return this.admin.listInvoices(query);
  }

  @Get('invoices/:id')
  getInvoice(@Param('id') id: string) {
    return this.admin.getInvoice(id);
  }

  @Get('invoices/:id/pdf')
  async downloadInvoicePdf(@Param('id') id: string): Promise<StreamableFile> {
    const { buffer, filename } = await this.admin.getInvoicePdf(id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('fiscal-issuer')
  getFiscalIssuer() {
    return this.admin.getFiscalIssuer();
  }

  @Put('fiscal-issuer')
  @HttpCode(HttpStatus.OK)
  updateFiscalIssuer(
    @Body() dto: UpdateFiscalIssuerDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    return this.admin.updateFiscalIssuer(dto, user.userId, ip);
  }
}
