import type { APIRequestContext } from '@playwright/test';
import { authedDelete, authedGet, authedPost } from './api';

/**
 * BARRERA: sembrar anuncios sin dejar generaciones huérfanas.
 *
 * ── El problema, medido ─────────────────────────────────────────────────────
 * Playwright **descarta el worker cuando un test falla** y arranca otro para el
 * siguiente — y lo hace TAMBIÉN con `--retries=0`. Eso vuelve a ejecutar el
 * `test.beforeAll` del fichero, que siembra OTRA generación de anuncios. Con un
 * `beforeAll` que crea 3 anuncios y tres fallos por delante, la página acaba
 * mostrando 3 generaciones a la vez.
 *
 * Así se veía en `tags-filtro.spec.ts` (una sola corrida, `--retries=0`):
 *
 *   strict mode violation: getByText(/B3 Con garantia y dueno/) resolved to 3 elements
 *     1) …B3 Con garantia y dueno 1785709834809
 *     2) …B3 Con garantia y dueno 1785709798431
 *     3) …B3 Con garantia y dueno 1785709760174
 *
 * Tres sellos distintos separados ~38 s: tres ejecuciones del mismo `beforeAll`
 * dentro de la MISMA corrida. No es arrastre entre corridas —`reset-test-db.js`
 * hace TRUNCATE de todas las tablas en cada `globalSetup`, así que eso ya estaba
 * cerrado— sino acumulación DENTRO de la corrida, y encima autoamplificada: cada
 * fallo siembra otra generación, que hace más probable el siguiente fallo.
 *
 * ── Por qué un registro en memoria no vale ──────────────────────────────────
 * El worker descartado es un PROCESO distinto: cualquier lista de "lo que he
 * creado" guardada en una variable se pierde justo cuando haría falta. Por eso
 * la limpieza no recuerda lo suyo, sino que **busca por prefijo** lo que haya
 * quedado de generaciones anteriores y lo borra antes de sembrar.
 *
 * ── Por qué borra por la API y no por Prisma ────────────────────────────────
 * Un anuncio vive en Postgres Y en Meilisearch. `DELETE /listings/:id` encola la
 * retirada del índice igual que en producción; un `deleteMany` de Prisma dejaría
 * el documento huérfano en Meili y la card seguiría apareciendo en la búsqueda,
 * que es justo lo que se quiere evitar (misma lección que el flush de Meili como
 * barrera aparte en el saneamiento de la base).
 */

interface ListingResumen {
  id: string;
  title: string;
}

/**
 * Borra los anuncios del usuario cuyo título empieza por `prefijo`.
 *
 * Pensado para llamarse al PRINCIPIO del `beforeAll` que siembra: deja el
 * terreno como si fuera la primera vez, sea o no la primera vez que corre.
 * Idempotente: si no hay nada que borrar, no hace nada.
 *
 * Solo toca anuncios DEL PROPIO USUARIO y con ESE prefijo — nunca datos de otro
 * spec ni del seed base.
 */
export async function limpiarAnunciosPorPrefijo(
  request: APIRequestContext,
  token: string,
  prefijo: string,
): Promise<number> {
  const previos: ListingResumen[] = [];

  // GET /users/me/listings devuelve { items, total, page, perPage }. Se recorre
  // hasta agotarlo, con un tope defensivo: es una limpieza de test, no debe
  // poder colgar la batería si el paginado se comportara de forma inesperada.
  for (let page = 1; page <= 20; page++) {
    const res = await authedGet(request, `/users/me/listings?page=${page}`, token);
    if (!res.ok()) break;
    const body = (await res.json()) as {
      items?: ListingResumen[];
      total?: number;
      perPage?: number;
    };
    const lote = body.items ?? [];
    previos.push(...lote.filter((l) => typeof l.title === 'string' && l.title.startsWith(prefijo)));
    const vistos = page * (body.perPage ?? lote.length ?? 0);
    if (lote.length === 0 || vistos >= (body.total ?? 0)) break;
  }

  for (const l of previos) {
    // Best-effort: si uno falla (ya borrado, carrera con otro worker) se sigue.
    // La limpieza no debe tumbar el spec que la llama.
    try {
      await authedDelete(request, `/listings/${l.id}`, token);
    } catch {
      /* se ignora a propósito — ver arriba */
    }
  }

  if (previos.length > 0) {
    console.log(`[seed-listings] limpiadas ${previos.length} generacion(es) previas de "${prefijo}"`);
  }
  return previos.length;
}

/** Crea un anuncio y lo publica. Devuelve id y slug. */
export async function publicarAnuncio(
  request: APIRequestContext,
  token: string,
  cuerpo: Record<string, unknown>,
): Promise<{ id: string; slug: string }> {
  const res = await authedPost(request, '/listings', token, cuerpo);
  if (!res.ok()) throw new Error(`[publicarAnuncio] alta ${res.status()} ${await res.text()}`);
  const creado = (await res.json()) as { id: string; slug: string };

  const pub = await authedPost(request, `/listings/${creado.id}/publish`, token, {});
  if (!pub.ok()) throw new Error(`[publicarAnuncio] publish ${pub.status()} ${await pub.text()}`);

  return { id: creado.id, slug: creado.slug };
}
