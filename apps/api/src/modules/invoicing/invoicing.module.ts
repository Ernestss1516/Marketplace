import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { INVOICING_PROVIDER, InvoicingProvider } from './invoicing.types';
import { StubInvoicingProvider } from './providers/stub-invoicing.provider';
import { InvoicingService } from './invoicing.service';
import { InvoicingController } from './invoicing.controller';

/**
 * InvoicingModule — cablea el puerto INVOICING_PROVIDER (RF.13).
 *
 * Selección por config (`invoicing.provider`, env INVOICING_PROVIDER):
 *   - "stub" (por defecto): StubInvoicingProvider — NO emite facturas válidas.
 *
 * CÓMO CONECTAR EL PROVEEDOR REAL (cuando Ernest lo elija):
 *   1. Añadir la implementación (p. ej. HoldedInvoicingProvider) en providers/.
 *   2. Añadir su valor a INVOICING_PROVIDER en env.validation (Joi .valid(...)) y
 *      un `case` en el useFactory de abajo que la devuelva.
 *   3. Poner INVOICING_PROVIDER=<nombre> en el .env de producción.
 * El resto del sistema NO cambia: habla solo con el token, nunca con la clase.
 */
@Module({
  controllers: [InvoicingController],
  providers: [
    StubInvoicingProvider,
    {
      provide: INVOICING_PROVIDER,
      inject: [ConfigService, StubInvoicingProvider],
      useFactory: (config: ConfigService, stub: StubInvoicingProvider): InvoicingProvider => {
        const provider = config.get<string>('invoicing.provider') ?? 'stub';
        switch (provider) {
          case 'stub':
            return stub;
          default:
            throw new Error(
              `INVOICING_PROVIDER="${provider}" no tiene implementación conectada todavía. ` +
                `Añade su clase en modules/invoicing/providers y un case en InvoicingModule.`,
            );
        }
      },
    },
    InvoicingService,
  ],
  exports: [INVOICING_PROVIDER, InvoicingService],
})
export class InvoicingModule {}
