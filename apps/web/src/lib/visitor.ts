import { createHash } from 'node:crypto';
import { headers } from 'next/headers';

/**
 * ESTADÍSTICAS A1 — LA IDENTIDAD DEL VISITANTE, REENVIADA POR EL BFF.
 *
 * ─── EL PROBLEMA ────────────────────────────────────────────────────────────────
 *
 * `/busqueda` y `/[categoria]` son Server Components: la llamada a `GET /search` la
 * hace **el servidor de Next**, no el navegador. Para NestJS, todas las búsquedas del
 * mundo vienen entonces de la MISMA IP —la de Next—, y el dedup de impresiones
 * (`sha256(ip:userAgent)`, el molde de `trackView`) colapsaría a todos los visitantes
 * en uno solo: la primera búsqueda contaría y las demás, durante media hora, no.
 *
 * Es la mutación exacta que el diseño señala: usar la IP de Next en vez de la
 * reenviada mata todas las impresiones menos una.
 *
 * ─── LA SOLUCIÓN, Y POR QUÉ CABE EN EL BFF ──────────────────────────────────────
 *
 * Esta capa **transporta identidad, no decide nada**: calcula la misma huella que
 * `ListingsController.trackView` calcularía si el navegador llamara directamente, y la
 * manda en una cabecera. Ninguna regla de negocio vive aquí — el backend sigue siendo
 * quien decide qué cuenta, cuánto dura la ventana de dedup y qué se hace con ella.
 *
 * ─── POR QUÉ UN HASH DE IP+UA Y NO UNA COOKIE ───────────────────────────────────
 *
 * Una cookie de visitante sería más precisa (distingue a dos personas tras el mismo
 * NAT), pero es un identificador PERSISTENTE nuevo, con lo que eso arrastra. El hash
 * de IP+UA no guarda nada en el navegador, no sobrevive a la petición y es exactamente
 * lo que la telemetría de vistas ya usa desde H8.C1: una regla, no dos.
 *
 * FICHERO APARTE Y NO DENTRO DE `lib/api/busqueda.ts`: aquél lo importan componentes de
 * cliente (los editores de bloques del backoffice), y `next/headers` en un módulo de
 * cliente rompe el build.
 */

/** La cabecera con la que viaja. La lee `SearchController` (`@Headers('x-visitor-hash')`). */
export const VISITOR_HASH_HEADER = 'x-visitor-hash';

/**
 * La huella, a partir de un lector de cabeceras. Función PURA y exportada para poder
 * probarla sin montar una petición de Next.
 *
 * `x-forwarded-for` puede traer una cadena de proxies («cliente, proxy1, proxy2»): el
 * primero es el cliente. Si no hay ninguna cabecera de IP se sigue adelante con la
 * cadena vacía — el hash queda entonces determinado sólo por el user-agent, que
 * deduplica de más pero nunca de menos.
 */
export function visitorHashFrom(get: (name: string) => string | null | undefined): string {
  const forwarded = get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0]?.trim() || get('x-real-ip')?.trim() || '';
  const userAgent = get('user-agent')?.trim() ?? '';
  return createHash('sha256').update(`${ip}:${userAgent}`).digest('hex');
}

/**
 * Las cabeceras a añadir a la llamada de búsqueda, listas para hacer spread.
 *
 * Devuelve `{}` si `headers()` no está disponible (render estático, o cualquier
 * contexto sin petición). Es deliberado: **una página nunca debe romperse porque no se
 * pueda identificar al visitante de una métrica de vanidad**. El backend, sin la
 * cabecera, cae a la IP que ve — y eso cuenta de menos, nunca de más.
 */
export async function visitorHeaders(): Promise<Record<string, string>> {
  try {
    const incoming = await headers();
    return { [VISITOR_HASH_HEADER]: visitorHashFrom((name) => incoming.get(name)) };
  } catch {
    return {};
  }
}
