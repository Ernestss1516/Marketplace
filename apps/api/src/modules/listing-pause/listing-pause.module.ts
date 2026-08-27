import { Module } from '@nestjs/common';
import { ListingActivationModule } from '../listing-activation/listing-activation.module';
import { ListingPauseService } from './listing-pause.service';

/**
 * RESIDUO BANNED — módulo propio, ligero y sin dominio detrás, para el gesto que
 * comparten el archivado (`AccountArchiveModule`) y el ban (`AdminModule`).
 *
 * MOLDE `ListingActivationModule`: sólo Prisma (global) y el hook de reindexado.
 * Importarlo no arrastra nada, que es la condición para que dos módulos que no se
 * conocen puedan compartir una pieza sin acoplarse entre ellos.
 */
@Module({
  imports: [ListingActivationModule],
  providers: [ListingPauseService],
  exports: [ListingPauseService],
})
export class ListingPauseModule {}
