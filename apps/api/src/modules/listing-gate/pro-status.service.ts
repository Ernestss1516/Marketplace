import { Injectable } from '@nestjs/common';
import { EntitlementType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * PUERTA — RÁFAGA 1. «¿Este usuario es Pro?», y nada más.
 *
 * POR QUÉ ESTO VIVE FUERA DE `BillingModule`. La puerta necesita saber si el
 * vendedor es Pro (la cuota depende del plan), y `BillingService.bump` /
 * `featuredByCredits` tendrán que consultar la puerta (el freno de
 * `needsRevalidation`, ráfaga 2). Si la puerta importara `BillingModule` y
 * `BillingModule` importara la puerta, sería un ciclo.
 *
 * Y el freno TIENE que vivir dentro de `BillingService`, no en sus llamantes:
 * bump/featured entran por TRES módulos distintos (`listings.controller`,
 * `billing.controller` y el cron `bump-auto.processor`), así que repartirlo son
 * tres sitios donde olvidarlo — el defecto que la puerta viene a cerrar.
 *
 * ES EL MISMO MOVIMIENTO QUE `infra/redis/cache-keys.ts`, cuyo comentario ya lo
 * dice de la clave de la ficha: «ninguno de los dos módulos puede importar del
 * otro sin invertir la dirección `ListingsModule → BillingModule`, así que no
 * puede vivir en ninguno de los dos».
 *
 * NO SE MOVIÓ `EntitlementService` ENTERO, y la distinción importa: son 273
 * líneas de conceptos de billing —cuota de destacados, cuota de bumps, clientes
 * de transacción— que no pintan nada en un módulo neutral. Lo que se comparte es
 * la PREGUNTA «¿es Pro?», que no es una operación de billing sino la lectura de
 * un hecho sobre el usuario. Misma distinción que hace `cache-keys.ts` al mover
 * el FORMATO de la clave y no la caché.
 *
 * UN SOLO LECTOR: `EntitlementService.isProActive` se conserva como puerta de
 * entrada de billing, pero DELEGA aquí — no hay una segunda copia de la consulta.
 * Dos implementaciones de «¿es Pro?» podrían divergir y nadie se enteraría hasta
 * que la cuota y el precio del plan dijeran cosas distintas del mismo usuario.
 */

/** Un entitlement vigente: sin revocar y sin caducar. */
function activeFilter(): Prisma.EntitlementWhereInput {
  const now = new Date();
  return { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

@Injectable()
export class ProStatusService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * True si el usuario tiene una suscripción PRO vigente.
   * Vigente = `revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now())`.
   */
  async isProActive(userId: string): Promise<boolean> {
    const row = await this.prisma.entitlement.findFirst({
      where: { userId, type: EntitlementType.PRO_SUBSCRIPTION, ...activeFilter() },
      select: { id: true },
    });
    return row !== null;
  }
}
