import type { BumpPricing } from '@/types';
import { resolveBumpCooldown } from '@/lib/bump-cooldown';

/**
 * UXV.4 — cómo se lee y se nombra la promoción de un anuncio. UNA sola vez, para las DOS
 * superficies de propietario.
 *
 * EL DEFECTO QUE CIERRA (transversal 2 de la auditoría): la tarjeta de `/mis-anuncios` y
 * las acciones de la ficha pública hacían lo mismo con nombres distintos —«Bump 5 cr.» vs
 * «Subir al inicio (bump)»—, con el coste visible en una y no en la otra, y con
 * confirmación en una y no en la otra. UXV.1 unificó el DATO del cooldown; esto unifica lo
 * que se le CUENTA al usuario.
 *
 * Es un módulo de funciones puras a propósito: sin hooks ni JSX, así que puede probarse
 * solo y no arrastra a quien lo importa a ser cliente.
 */

/** Con qué se pagaría el próximo bump, por orden de consumo real del backend. */
export type BumpFunding = 'PRO_QUOTA' | 'BUMP_BALANCE' | 'CREDITS';

export interface BumpOffer {
  /** De dónde saldría el próximo bump. El backend consume en este mismo orden. */
  funding: BumpFunding;
  /** true si al usuario no le cuesta créditos (cuota Pro o saldo de bumps). */
  free: boolean;
  /** Créditos que costaría. 0 cuando es gratis. */
  creditCost: number;
  /** Cuántos quedan de la bolsa gratuita que se usaría. */
  remaining: number;
  /** Cooldown vigente: no se puede bumpear todavía. */
  onCooldown: boolean;
  until: Date | null;
}

/**
 * Qué pasaría si el usuario bumpease AHORA.
 *
 * El orden de consumo (cuota Pro → saldo de bumps → créditos) no se decide aquí: es el que
 * aplica `BillingService.bump`. Se replica para poder ANUNCIARLO antes del clic; si el
 * backend cambiara el orden, este es el único sitio del frontend que hay que seguir.
 */
export function resolveBumpOffer(pricing: BumpPricing, nextBumpAt?: string | null): BumpOffer {
  const { active: onCooldown, until } = resolveBumpCooldown(nextBumpAt);

  if (pricing.bumpQuota.remaining > 0) {
    return {
      funding: 'PRO_QUOTA',
      free: true,
      creditCost: 0,
      remaining: pricing.bumpQuota.remaining,
      onCooldown,
      until,
    };
  }
  if (pricing.bumpBalance > 0) {
    return {
      funding: 'BUMP_BALANCE',
      free: true,
      creditCost: 0,
      remaining: pricing.bumpBalance,
      onCooldown,
      until,
    };
  }
  return {
    funding: 'CREDITS',
    free: false,
    creditCost: pricing.bumpCreditCost,
    remaining: 0,
    onCooldown,
    until,
  };
}

/**
 * El coste del bump, en una línea, IGUAL en las dos superficies. Antes la ficha no decía
 * nada del coste y la tarjeta lo pintaba con tachado y porcentaje: el mismo usuario veía
 * dos precios distintos del mismo producto según por dónde entrase.
 */
export function bumpCostLabel(pricing: BumpPricing, offer: BumpOffer): string {
  if (offer.free) {
    return offer.funding === 'PRO_QUOTA'
      ? `Gratis · te quedan ${offer.remaining} este mes`
      : `Gratis · te quedan ${offer.remaining} guardados`;
  }
  if (pricing.bumpDiscountPercent != null && pricing.bumpOriginalCreditCost != null) {
    return `${pricing.bumpCreditCost} créditos (antes ${pricing.bumpOriginalCreditCost}, -${pricing.bumpDiscountPercent}%)`;
  }
  return `${pricing.bumpCreditCost} créditos`;
}

/** Rótulo del control primario. Corto: vive dentro de una tarjeta. */
export function promocionarLabel(offer: BumpOffer): string {
  return offer.free && !offer.onCooldown ? 'Subir gratis' : 'Promocionar';
}

/**
 * Estados en los que promocionar tiene sentido. Un borrador no se sube ni se destaca (no
 * está en el catálogo), y uno vendido o archivado tampoco.
 */
export function canPromote(status: string): boolean {
  return status === 'ACTIVE';
}
