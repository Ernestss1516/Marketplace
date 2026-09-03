import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { FilterableAttributesResolver } from './filterable-attributes.resolver';
import { MeilisearchModule } from '../../infra/meilisearch/meilisearch.module';
import { CategoryTreeModule } from '../categories/category-tree.module';

/**
 * EL NÚCLEO DE LA BÚSQUEDA, SIN CONTROLADOR. **Módulo HOJA.**
 *
 * ── QUÉ DEFECTO CIERRA ───────────────────────────────────────────────────────────────────
 *
 * `SearchModule` declara el `SearchController`, y **Nest instancia un controlador aunque
 * nadie lo use**: en un contexto de aplicación (`createApplicationContext`) basta con que el
 * módulo lo declare. Así que los comandos de administración —que sólo quieren
 * `SearchService.indexListing`— arrastraban toda la cadena del controlador:
 *
 *     ReindexModule → SearchModule → SponsoredAdsModule (→ RedisService, R2Service)
 *                                  → ReviewsModule      (→ BullModule.registerQueue)
 *                                  → ImpressionsModule  (→ RedisService)
 *                                  → TagsModule
 *
 * Eso costó **tres incidentes de la misma familia**, cada uno arreglado con un parche
 * distinto porque nadie miró la forma:
 *
 *  1. **H6.6** metió `SponsoredAdsModule` y `pnpm reindex` dejó de arrancar («Nest can't
 *     resolve dependencies of SponsoredAdsService»). Se parcheó importando `RedisModule` y
 *     `R2Module` en el comando.
 *  2. **N4a** (`bcf4064`) metió una cola de BullMQ en `ReviewsModule`. Esa `Queue` abre **su
 *     propia** conexión ioredis —que no es la de `RedisService`, así que el `quit()` del
 *     parche anterior no la tocaba— y el comando dejó de TERMINAR: medido el 2026-09-03,
 *     el proceso seguía vivo con 517 MB y 2 conexiones dos minutos después de escribir
 *     «Reindex complete». Es el origen de los `node` huérfanos que ensuciaron varias
 *     sesiones.
 *  3. **A1** metió `ImpressionsModule` (que también necesita `RedisService`) y rompió
 *     `geocode-backfill`, que nunca recibió el parche de (1): hoy ni arranca.
 *
 * ── POR QUÉ ESTE MÓDULO Y NO OTRO PARCHE ────────────────────────────────────────────────
 *
 * Cerrar a mano la conexión de la cola habría arreglado (2) y dejado la fuente abierta: el
 * cuarto módulo que alguien cuelgue de `SearchModule` vuelve a romper los comandos, y el
 * síntoma aparecerá lejos de la causa. Lo que había que arreglar no es la conexión, es que
 * **el comando no tenga por qué abrirla**.
 *
 * `SearchService` sólo depende de `MeilisearchService`, `FilterableAttributesResolver` y
 * `CategoryTreeService` — verificado en su constructor. Ninguno de los tres toca Redis ni
 * BullMQ, y `MeilisearchModule` y `CategoryTreeModule` son hojas. Así que el núcleo se
 * sostiene solo, y lo que sobraba era el controlador.
 *
 * ── HOJA, EN EL SENTIDO QUE YA USA EL REPO ──────────────────────────────────────────────
 *
 * Mismo movimiento y misma razón que `CategoryTreeModule` («no importa ningún módulo de
 * dominio, así que puede importarlo cualquiera sin arriesgar un ciclo») y que
 * `ListingActivationModule`. Aquí gana además una propiedad que hay que poder afirmar:
 * **el contexto que lo importa no puede acabar con una cola de BullMQ dentro**. Hay barrera
 * que lo comprueba (`test/comandos-standalone.e2e-spec.ts`), porque esto ya se rompió tres
 * veces por accidente y la cuarta llegaría igual.
 *
 * `SearchModule` lo importa y lo RE-EXPORTA, así que para sus consumidores de siempre
 * (`AppModule`, `AdminModule`, `AlertsModule`, `QueueModule`) no cambia nada.
 */
@Module({
  imports: [MeilisearchModule, CategoryTreeModule],
  providers: [SearchService, FilterableAttributesResolver],
  exports: [SearchService, FilterableAttributesResolver],
})
export class SearchCoreModule {}
