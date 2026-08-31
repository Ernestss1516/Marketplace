import { Module } from '@nestjs/common';
import { ListingExpiryService } from './listing-expiry.service';

/**
 * MÓDULO HOJA — sólo el lector del plazo de caducidad.
 *
 * Su única dependencia es `PrismaService`, que es `@Global`, así que no importa nada. Por eso
 * los cuatro módulos que escriben `Listing.expiresAt` (listings, moderación, admin y archivo de
 * cuentas) pueden importarlo sin abrir ningún ciclo — que es lo que sí habría pasado importando
 * `ExpirationModule`, que arrastra la cola de indexado, la auditoría y tres servicios de
 * notificaciones.
 *
 * Mismo criterio que `ListingGateModule`, que es hoja por lo mismo y se importa desde billing.
 */
@Module({
  providers: [ListingExpiryService],
  exports: [ListingExpiryService],
})
export class ListingExpiryModule {}
