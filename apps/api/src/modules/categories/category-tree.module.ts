import { Module } from '@nestjs/common';
import { CategoryTreeService } from './category-tree.service';

/**
 * PROFUNDIDAD N — RÁFAGA 1. Módulo HOJA: no importa ningún módulo de dominio
 * (`PrismaModule` es `@Global`), así que puede importarlo cualquiera sin
 * arriesgar un ciclo.
 *
 * NO va dentro de `CategoriesModule` a propósito: ese ya importa
 * `ListingsModule` y `TagsModule`, y los dos consumen `CategoryTreeService` —
 * habría sido un ciclo. Molde: `ListingActivationModule`, que existe por la
 * misma razón y lo comparten `ListingsModule` y `ModerationModule`.
 */
@Module({
  providers: [CategoryTreeService],
  exports: [CategoryTreeService],
})
export class CategoryTreeModule {}
