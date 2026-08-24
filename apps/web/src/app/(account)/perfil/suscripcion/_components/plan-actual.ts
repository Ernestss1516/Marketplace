import type { MyEntitlement, MySubscription } from '@/lib/api/billing';

/**
 * QUÉ PLAN TIENE ESTE USUARIO — y son TRES casos, no dos.
 *
 * EL DEFECTO (§1.5, H-1). La página tenía exactamente dos ramas escritas en el JSX: «hay
 * `Subscription`» pintaba todo el contenido, y «ni suscripción ni Pro» pintaba la tarjeta de
 * «no tienes plan». Entre las dos quedaba un hueco por el que se caía un caso real: el Pro
 * CONCEDIDO por el equipo, que es Pro **sin** suscripción. Veía la cabecera «Plan Pro» y
 * debajo, nada — una página en blanco justo a quien acababan de regalarle el plan.
 *
 * POR QUÉ ES UNA FUNCIÓN Y NO DOS CONDICIONES EN EL MARCADO. Un hueco entre dos `&&` no se
 * ve leyendo el JSX; un caso que falta en una unión discriminada sí, porque hay que
 * nombrarlo. Sacar la decisión aquí es lo que convierte «se nos olvidó una rama» en algo que
 * un tipo y una prueba pueden sujetar.
 *
 * LOS DOS EJES, que es de donde salía la confusión: «ser Pro» lo dice un `Entitlement`;
 * «tener suscripción de pago» lo dice una `Subscription`. El backend nunca los mezcló.
 */
export type PlanActual =
  /** Cliente de pago: hay suscripción que gestionar (aunque esté PAST_DUE o cancelándose). */
  | { tipo: 'DE_PAGO'; suscripcion: MySubscription }
  /** Pro CONCEDIDO por el equipo: tiene las ventajas, no hay nada que cobrar ni gestionar. */
  | { tipo: 'CONCEDIDO'; expiresAt: string | null }
  /** Ni una cosa ni la otra. */
  | { tipo: 'GRATUITO' };

/**
 * `subscriptionId === null` ES la marca de procedencia de un Pro concedido: no hay columna
 * `source`, y el backoffice parte los entitlements exactamente por ese criterio.
 *
 * La suscripción manda sobre la concesión cuando existen las dos: lo que el usuario necesita
 * gestionar es el cobro, y un Pro de regalo encima de uno pagado no cambia eso.
 */
export function resolverPlan(
  subscriptions: MySubscription[],
  entitlements: MyEntitlement[],
): PlanActual {
  const suscripcion = subscriptions[0];
  if (suscripcion) return { tipo: 'DE_PAGO', suscripcion };

  const concedido = entitlements.find(
    (e) => e.type === 'PRO_SUBSCRIPTION' && !e.revokedAt && e.subscriptionId === null,
  );
  if (concedido) return { tipo: 'CONCEDIDO', expiresAt: concedido.expiresAt };

  return { tipo: 'GRATUITO' };
}
