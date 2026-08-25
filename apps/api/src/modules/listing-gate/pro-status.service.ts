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

/**
 * «ES PRO AHORA», como CONDICIÓN DE CONSULTA — para quien necesita filtrar en la base en
 * vez de preguntar por un usuario suelto.
 *
 * Se exporta porque `#15` (la marca de Pro en la bandeja de tickets) necesita un
 * `where` de Prisma —«dame los tickets cuyo autor es Pro»— y resolverlo trayendo los
 * tickets y preguntando uno a uno sería el N+1 que esa ráfaga existe para evitar. Sin
 * esto, quien filtre acabaría escribiendo su propia versión del predicado, y **dos
 * definiciones de «es Pro» que se separan es exactamente lo que el doc-comment de arriba
 * dice que no puede pasar**: la cuota y el precio del plan empezarían a decir cosas
 * distintas del mismo usuario.
 *
 * Devuelve la condición sobre `Entitlement`; quien la use la enchufa donde le toque
 * (`user: { entitlements: { some: proActiveEntitlementWhere() } }`).
 */
export function proActiveEntitlementWhere(): Prisma.EntitlementWhereInput {
  return { type: EntitlementType.PRO_SUBSCRIPTION, ...activeFilter() };
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
      where: { userId, ...proActiveEntitlementWhere() },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * La MISMA pregunta, para muchos usuarios y en UNA consulta.
   *
   * Existe por el N+1 de la bandeja de tickets (#15): una página son 25 tickets, y
   * preguntar `isProActive` por cada autor son 25 viajes a la base para pintar una
   * insignia. Con `IN` es uno.
   *
   * Devuelve el conjunto de los que SÍ son Pro; quien pregunte por uno que no esté
   * simplemente no lo encuentra. `distinct` porque un usuario puede tener más de un
   * entitlement vigente (uno de pago y otro concedido a mano conviven — es el caso que
   * documenta `entitlement.service.ts`), y aquí sólo interesa el hecho.
   */
  async proActiveAmong(userIds: readonly string[]): Promise<Set<string>> {
    const unicos = [...new Set(userIds)];
    if (unicos.length === 0) return new Set();

    const filas = await this.prisma.entitlement.findMany({
      where: { userId: { in: unicos }, ...proActiveEntitlementWhere() },
      select: { userId: true },
      distinct: ['userId'],
    });
    return new Set(filas.map((f) => f.userId));
  }
}
