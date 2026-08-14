import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { ProStatusService } from '../pro-status.service';
import {
  DEFAULT_FREE_ACTIVE_LIMIT,
  DEFAULT_PRO_ACTIVE_LIMIT,
  FREE_ACTIVE_LIMIT_SETTING,
  PRO_ACTIVE_LIMIT_SETTING,
} from '../listing-limits';
import type { GateContext, GateListing, GateReason, ListingGateRule } from '../listing-gate.types';

/**
 * Los topes por defecto y sus claves salen de `listing-limits.ts` — los MISMOS
 * números de siempre (5 y 20), sólo que ahora viven al lado de los del límite
 * total. Están juntos porque su relación es una invariante (total > activos) y
 * hay una guarda de admin que la comprueba: con los números en dos ficheros,
 * cambiar uno y olvidar el otro no daría ningún error.
 */

/**
 * RF.7 — LA CUOTA DE ANUNCIOS ACTIVOS DEL PLAN, ahora como regla de la puerta.
 *
 * ESTO NO ES UNA REGLA NUEVA: es la que ya existía, movida. Vivía en
 * `ListingsService.checkActiveListingLimit`, era `private`, y por eso
 * `ModerationService` y `AdminService` no podían usarla ni aunque quisieran —
 * que es exactamente por lo que se escapaba por cuatro caminos hasta que la
 * ráfaga (A) tapó tres a mano. Al mudarse aquí deja de ser inalcanzable, y los
 * caminos no la «recuerdan»: la heredan por pasar por la puerta.
 *
 * LA LÓGICA ES BYTE-IDÉNTICA a la anterior, a propósito, incluida una
 * particularidad que se CONSERVA: el conteo incluye al propio anuncio si ya está
 * ACTIVE, así que renovar estando justo en el tope falla. Es el comportamiento
 * que hay desde RF.7 y que los tests fijan; cambiarlo sería una decisión de
 * producto, no parte de centralizar.
 *
 * `appliesTo` — SÓLO ACCIONES DE VENDEDOR. **Staff está exento, y es una
 * decisión formalizada, no un olvido.** Un moderador puede activar por encima
 * del cupo del vendedor porque el trabajo de moderación no puede quedar rehén de
 * la cuota de un tercero: si el vendedor llena su cupo mientras su anuncio
 * espera revisión, el moderador tiene que poder aprobarlo igual. Antes esto ya
 * pasaba, pero de FACTO —nadie lo había escrito—; ahora es esta línea. Ver
 * docs/diseno-puerta-validacion.md, D3.
 *
 * Tampoco aplica a `bump`/`featured`: no crean una plaza nueva, operan sobre un
 * anuncio que ya está ACTIVE y ya la ocupa.
 */
@Injectable()
export class ActiveListingLimitRule implements ListingGateRule {
  readonly name = 'active-listing-limit';
  /** Barata: dos consultas cortas, sin resolver categorías. */
  readonly group = 'entrada' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly proStatus: ProStatusService,
  ) {}

  appliesTo(context: GateContext): boolean {
    if (context.actor !== 'seller') return false;
    return context.transition !== 'bump' && context.transition !== 'featured';
  }

  async check(listing: GateListing): Promise<GateReason | null> {
    const isPro = await this.proStatus.isProActive(listing.sellerId);
    const settingKey = isPro ? PRO_ACTIVE_LIMIT_SETTING : FREE_ACTIVE_LIMIT_SETTING;
    const defaultLimit = isPro ? DEFAULT_PRO_ACTIVE_LIMIT : DEFAULT_FREE_ACTIVE_LIMIT;

    const setting = await this.prisma.setting.findUnique({ where: { key: settingKey } });
    const limit = setting ? Number(setting.value) : defaultLimit;

    const activeCount = await this.prisma.listing.count({
      where: { sellerId: listing.sellerId, status: 'ACTIVE' },
    });
    if (activeCount < limit) return null;

    return {
      code: 'ACTIVE_LIMIT_REACHED',
      // Mensaje IDÉNTICO al que daba `checkActiveListingLimit`: es texto que ya
      // se muestra al usuario y que algún test puede estar comprobando.
      message: `Has alcanzado el límite de ${limit} anuncios activos de tu plan`,
    };
  }
}
