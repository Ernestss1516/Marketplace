import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchCoreModule } from './search-core.module';
import { SponsoredAdsModule } from '../sponsored-ads/sponsored-ads.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { TagsModule } from '../tags/tags.module';
import { ImpressionsModule } from '../impressions/impressions.module';

/**
 * LA BÚSQUEDA COMPLETA: el núcleo **más su controlador**, con todo lo que el controlador
 * necesita.
 *
 * LA SEPARACIÓN NO ES COSMÉTICA. Los cuatro módulos de abajo son del CONTROLADOR, no del
 * servicio: patrocinados para el hueco de publicidad, valoraciones y tags para enriquecer la
 * respuesta, impresiones para contar. `SearchService` no conoce a ninguno. Mientras vivían
 * todos en el mismo módulo, cualquier comando que quisiera indexar se los llevaba puestos —
 * y con ellos Redis y una cola de BullMQ, que es lo que dejaba `pnpm reindex` colgado. El
 * porqué entero, con los tres incidentes que costó, está en `search-core.module.ts`.
 *
 * RE-EXPORTA `SearchCoreModule`, así que quien importaba `SearchModule` para inyectar
 * `SearchService` o `FilterableAttributesResolver` sigue igual: `AppModule`, `AdminModule`,
 * `AlertsModule` y `QueueModule` no se tocan.
 */
@Module({
  imports: [
    SearchCoreModule,
    SponsoredAdsModule,
    ReviewsModule,
    TagsModule,
    // A1 — lo importa el módulo de BÚSQUEDA porque quien cuenta es su CONTROLADOR.
    // `SearchService` no lo conoce, y esa ignorancia es lo que garantiza que las
    // alertas (que sí usan el servicio) no generen impresiones.
    ImpressionsModule,
  ],
  controllers: [SearchController],
  exports: [SearchCoreModule],
})
export class SearchModule {}
