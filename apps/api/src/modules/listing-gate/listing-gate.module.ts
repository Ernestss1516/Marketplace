import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_REVALIDATION, retryQueue } from '../../infra/queue/queue.constants';
import { CategoryTreeModule } from '../categories/category-tree.module';
import { ListingGateService } from './listing-gate.service';
import { ProStatusService } from './pro-status.service';
import { AttributeCheckService } from './attribute-check.service';
import { RevalidationService } from './revalidation.service';
import { RevalidationProcessor } from './revalidation.processor';
import { ActiveListingLimitRule } from './rules/active-listing-limit.rule';
import { AttributeRevalidationRule } from './rules/attribute-revalidation.rule';
import { LISTING_GATE_RULES, type ListingGateRule } from './listing-gate.types';

/**
 * PUERTA DE VALIDACIÓN — MÓDULO HOJA.
 *
 * No importa NINGÚN módulo de dominio (`PrismaModule` es `@Global`), y esa
 * ausencia es el diseño: lo importan `ListingsModule`, `ModerationModule`,
 * `AdminModule` y `BillingModule` (este último sólo por `ProStatusService`) sin
 * que ninguno pueda crear un ciclo. Molde: `CategoryTreeModule` y
 * `ListingActivationModule`, que existen por lo mismo.
 *
 * Si algún día una regla necesitara algo de un módulo de dominio, la salida NO
 * es importarlo aquí —eso reabriría el ciclo que este módulo evita— sino mover
 * la pieza compartida a un sitio neutral, como se hizo con `ProStatusService` y
 * antes con `cache-keys.ts`.
 *
 * LA LISTA DE REGLAS ES UN PROVIDER, no un array escrito dentro del servicio.
 * Dos motivos:
 *  1. Añadir una regla es añadir una línea AQUÍ; la puerta no se toca.
 *  2. Un test puede sustituirla (`overrideProvider`) para inyectar una regla que
 *     siempre falla y comprobar que TODOS los caminos pasan por la puerta — la
 *     barrera estructural que sustituye a «acuérdate de llamarla».
 *
 * `enabled` LLEGÓ EN LA RÁFAGA 2, con la primera regla que tenía algo que apagar:
 * la de atributos nace APAGADA y se enciende con el número de M2 delante. La
 * cuota no lo implementa, así que está siempre encendida — que es lo correcto
 * para una regla que lleva años aplicándose.
 */
@Module({
  imports: [
    // RÁFAGA 2 — la regla de atributos necesita la CADENA de categorías para
    // plegar el schema efectivo. `CategoryTreeModule` es hoja igual que éste, así
    // que importarlo no reabre ningún ciclo.
    CategoryTreeModule,
    BullModule.registerQueue(retryQueue(QUEUE_REVALIDATION)),
  ],
  providers: [
    ProStatusService,
    AttributeCheckService,
    RevalidationService,
    RevalidationProcessor,
    ActiveListingLimitRule,
    AttributeRevalidationRule,
    ListingGateService,
    {
      provide: LISTING_GATE_RULES,
      inject: [ActiveListingLimitRule, AttributeRevalidationRule],
      // El orden dentro de un grupo es el de esta lista. Entre grupos manda
      // `GateRuleGroup` (entrada antes que contenido), no esto.
      useFactory: (
        activeLimit: ActiveListingLimitRule,
        attributes: AttributeRevalidationRule,
      ): ListingGateRule[] => [activeLimit, attributes],
    },
  ],
  exports: [ListingGateService, ProStatusService, RevalidationService, AttributeCheckService],
})
export class ListingGateModule {}
