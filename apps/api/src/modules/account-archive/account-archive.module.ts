import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_BILLING, retryQueue } from '../../infra/queue/queue.constants';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ListingActivationModule } from '../listing-activation/listing-activation.module';
import { ListingGateModule } from '../listing-gate/listing-gate.module';
import { AccountArchiveService } from './account-archive.service';

/**
 * BORRADO DE CUENTAS C2 — módulo propio para un gesto con DOS LLAMANTES que no se
 * conocen: `UsersModule` (el usuario se archiva a sí mismo desde `/perfil`) y
 * `AdminModule` (el staff archiva y desarchiva). Ninguno de los dos importa al
 * otro, así que el servicio no puede vivir dentro de ninguno.
 *
 * NO IMPORTA `BillingModule`, y es deliberado: la cancelación de la suscripción
 * viaja por la COLA de facturación (`QUEUE_BILLING`), no por una llamada directa.
 * Así el archivado no arrastra medio módulo de cobros, y de paso gana los
 * reintentos que la cola ya trae — que es justo lo que ese camino necesita
 * (diseño §6.5).
 */
@Module({
  imports: [
    AuditLogModule,
    ListingActivationModule,
    ListingGateModule,
    BullModule.registerQueue(retryQueue(QUEUE_BILLING)),
  ],
  providers: [AccountArchiveService],
  exports: [AccountArchiveService],
})
export class AccountArchiveModule {}
