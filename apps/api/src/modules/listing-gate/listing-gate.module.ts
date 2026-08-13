import { Module } from '@nestjs/common';
import { ListingGateService } from './listing-gate.service';
import { ProStatusService } from './pro-status.service';
import { ActiveListingLimitRule } from './rules/active-listing-limit.rule';
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
 * SIN `enabled` TODAVÍA, y es deliberado. El diseño lo prevé para que la regla de
 * atributos (ráfaga 2) pueda nacer apagada, pero pone su propia condición: «cada
 * `enabled` nace con su lector o no nace» —este repo ya arrastra dos ajustes
 * muertos (`listingExpiryDays`, `contactRequiresVerification`)—. La cuota no lo
 * necesita: nace encendida y encendida se queda. El interruptor llega con la
 * primera regla que tenga algo que apagar.
 */
@Module({
  providers: [
    ProStatusService,
    ActiveListingLimitRule,
    ListingGateService,
    {
      provide: LISTING_GATE_RULES,
      inject: [ActiveListingLimitRule],
      // El orden dentro de un grupo es el de esta lista. Entre grupos manda
      // `GateRuleGroup` (entrada antes que contenido), no esto.
      useFactory: (activeLimit: ActiveListingLimitRule): ListingGateRule[] => [activeLimit],
    },
  ],
  exports: [ListingGateService, ProStatusService],
})
export class ListingGateModule {}
