import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { InvoicingService } from './invoicing.service';

/**
 * Endpoints de usuario para EMISIÓN de facturas (RF.13). Bajo el prefijo
 * `billing` (junto a los de cobros), pero owner-scoped: el usuario solo ve y
 * gestiona lo suyo. Hasta conectar un proveedor homologado, el PDF que se
 * descarga es el del stub, marcado "NO VÁLIDO FISCALMENTE".
 */
@ApiTags('Billing')
@ApiBearerAuth('access-token')
@Controller('billing')
export class InvoicingController {
  constructor(private readonly invoicing: InvoicingService) {}

  @Get('facturables')
  @UseGuards(JwtAuthGuard)
  getFacturables(@CurrentUser() user: JwtUser) {
    return this.invoicing.getFacturables(user.userId);
  }

  @Get('eligibility')
  @UseGuards(JwtAuthGuard)
  getEligibility(@CurrentUser() user: JwtUser) {
    return this.invoicing.getEligibility(user.userId);
  }

  @Post('facturas')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  requestInvoice(@CurrentUser() user: JwtUser) {
    return this.invoicing.requestInvoice(user.userId);
  }

  @Get('my-invoices')
  @UseGuards(JwtAuthGuard)
  getMyInvoices(@CurrentUser() user: JwtUser) {
    return this.invoicing.getMyInvoices(user.userId);
  }

  @Get('invoices/:id/pdf')
  @UseGuards(JwtAuthGuard)
  async downloadInvoicePdf(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.invoicing.getInvoicePdf(user.userId, id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
