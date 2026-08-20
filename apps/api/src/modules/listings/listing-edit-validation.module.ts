import { Module } from '@nestjs/common';
import { CategoryTreeModule } from '../categories/category-tree.module';
import { TagsModule } from '../tags/tags.module';
import { ListingEditValidationService } from './listing-edit-validation.service';

/**
 * P3a — MÓDULO NEUTRAL para las reglas de los campos de un anuncio.
 *
 * Existe por el mismo motivo que `CategoryTreeModule` y `ListingActivationModule`:
 * lo necesitan DOS módulos que no pueden verse entre sí. `ListingsModule` tiene
 * el camino del dueño y `AdminModule` el del staff, y `AdminModule` **no importa
 * ListingsModule** —lo dice el comentario de `listing-status.transitions.ts`—;
 * hacerle importarlo arrastraría billing, mensajería, moderación y
 * notificaciones para usar seis validaciones.
 *
 * Sus dos dependencias son ligeras: `CategoryTreeModule` es hoja y `TagsModule`
 * sólo depende de auditoría, Meilisearch y el propio árbol de categorías.
 */
@Module({
  imports: [CategoryTreeModule, TagsModule],
  providers: [ListingEditValidationService],
  exports: [ListingEditValidationService],
})
export class ListingEditValidationModule {}
