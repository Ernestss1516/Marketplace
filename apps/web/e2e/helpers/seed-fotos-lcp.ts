import type { APIRequestContext } from '@playwright/test';
import { adminApiToken, authedGet, authedPost } from './api';
import { fotoDeterminista } from './foto-determinista';

/**
 * LA SEMILLA CON FOTOS — ocho destacados con imagen de verdad, por el camino de verdad.
 *
 * ── LAS TRES SALIDAS QUE SE CONSIDERARON, Y POR QUÉ ÉSTA ────────────────────────────────
 *
 *  (a) **Subir el objeto a MinIO por el pipeline real** (lo que hace esto). El riesgo que se
 *      temía era añadir MinIO como punto de fallo de la medición. **No lo añade**: MinIO ya
 *      es dependencia dura de esta batería —diecisiete specs suben ficheros por él, el CI lo
 *      arranca con `docker run` y espera su `/minio/health/live` antes de correr nada— y de
 *      la aplicación entera. Lo que esta semilla mete en el camino ya estaba en el camino.
 *
 *  (b) **Un fichero estático del repositorio** (`/public/foto.png`), sin MinIO. Evita un
 *      punto de fallo que resulta que no era nuevo, y a cambio **deja de medir lo que se
 *      quería medir**: la petición de una imagen estática la sirve el propio Next desde
 *      disco, mientras que la de un anuncio es `/_next/image` haciendo un `fetch` DE SERVIDOR
 *      contra MinIO, redimensionando y cacheando. Ese tramo —el que se ha roto tres veces en
 *      esta máquina, ver CLAUDE.md— es justo el que las dos filas de destacados duplican. Un
 *      LCP medido sin él sería otro número igual de decorativo que el del texto.
 *
 *  (c) **Una imagen embebida** (`data:`). `next/image` ni siquiera la acepta como `src`
 *      remota, y aunque la aceptara mediría una imagen que no viaja por la red. Descartada
 *      sin más.
 *
 * Se elige (a): es la única que es determinista **y** mide el camino real.
 *
 * ── POR QUÉ POR HTTP Y NO ESCRIBIENDO EN POSTGRES ───────────────────────────────────────
 *
 * Un anuncio no está «en /busqueda» por estar en Postgres: está cuando **Meilisearch lo
 * tiene**, y quien lo mete es la cola de indexación de la API al publicar. Y `boostScore` no
 * es un campo que se pueda poner a mano: sale de que exista un `Entitlement` de destacado
 * vigente EN EL MOMENTO DE INDEXAR. Una semilla por Prisma tendría que reimplementar las dos
 * cosas, y entonces lo que se mide deja de ser lo que hace el sitio.
 *
 * Así que se siembra por donde lo haría un vendedor: subir la foto, publicar el anuncio y
 * destacarlo pagando (con créditos que el administrador concede antes). Cuatro llamadas por
 * anuncio, todas de producción.
 */

const API_BASE = 'http://localhost:3001';

/** Lo que la semilla devuelve de cada anuncio sembrado. */
export interface AnuncioConFoto {
  id: string;
  slug: string;
  title: string;
  /** La URL pública del objeto en MinIO — la que `next/image` va a buscar del lado servidor. */
  urlFoto: string;
}

/**
 * Sube la foto determinista y devuelve el id de la `ListingImage` recién creada.
 *
 * Multipart a mano porque `authedPost` manda JSON: `POST /media/upload` es el ÚNICO endpoint
 * de imagen de anuncio y consume `multipart/form-data` (`FileInterceptor` + `memoryStorage`).
 */
async function subirFoto(
  request: APIRequestContext,
  token: string,
  nombre: string,
): Promise<{ id: string; url: string }> {
  const res = await request.post(`${API_BASE}/api/media/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: nombre, mimeType: 'image/png', buffer: fotoDeterminista() },
    },
  });
  if (!res.ok()) throw new Error(`[seed-fotos] subida ${res.status()} ${await res.text()}`);
  return (await res.json()) as { id: string; url: string };
}

/**
 * Concede créditos al vendedor para poder destacar sin pasar por un TPV.
 *
 * Es una acción REAL de administrador (`POST /admin/billing/users/:id/credits`), no un
 * atajo de pruebas: el saldo se gasta después por el mismo `featured-by-credits` que usa el
 * diálogo de promocionar. Ninguna otra spec destaca de verdad —todas mockean el catálogo y
 * la cartera—, así que este camino no estaba ejercitado en Playwright hasta ahora.
 */
async function concederCreditos(
  request: APIRequestContext,
  userId: string,
  cantidad: number,
): Promise<void> {
  const res = await authedPost(request, `/admin/billing/users/${userId}/credits`, adminApiToken(), {
    amount: cantidad,
    reason: 'Semilla e2e: medir el LCP de /busqueda con destacados con foto',
  });
  if (!res.ok()) {
    throw new Error(`[seed-fotos] créditos ${res.status()} ${await res.text()}`);
  }
}

/** El precio de destacado de 7 días del catálogo real (lo siembra `prisma/seed-test.ts`). */
async function precioDestacado7d(request: APIRequestContext): Promise<string> {
  const res = await authedGet(request, '/billing/catalog');
  if (!res.ok()) throw new Error(`[seed-fotos] catálogo ${res.status()} ${await res.text()}`);
  const { products } = (await res.json()) as {
    products: { prices: { priceId: string; durationDays?: number | null }[] }[];
  };
  for (const producto of products) {
    const precio = producto.prices.find((p) => p.durationDays === 7);
    if (precio) return precio.priceId;
  }
  throw new Error(
    '[seed-fotos] el catálogo no trae un precio de destacado de 7 días. ' +
      'Lo siembra `prisma/seed-test.ts` (seedFeaturedPrices); sin él no hay forma de destacar.',
  );
}

/**
 * Siembra `cuantos` anuncios ACTIVE, con foto y DESTACADOS, y espera a que Meilisearch los
 * tenga con `boostScore = 1`.
 *
 * `marca` es la palabra que identifica a estos anuncios en la búsqueda: se busca por ella
 * para que el bloque de destacados de /busqueda sea EXACTAMENTE éstos y no lo que haya
 * dejado otra spec.
 */
export async function sembrarDestacadosConFoto(
  request: APIRequestContext,
  token: string,
  opciones: { marca: string; sello: string; cuantos: number },
): Promise<AnuncioConFoto[]> {
  const { marca, sello, cuantos } = opciones;

  const yo = await authedGet(request, '/users/me', token);
  if (!yo.ok()) throw new Error(`[seed-fotos] /users/me ${yo.status()}`);
  const { id: userId } = (await yo.json()) as { id: string };

  const categoria = await (await request.get(`${API_BASE}/api/categories/moviles`)).json();

  // `moviles` no tiene atributos obligatorios (a diferencia de `coches`, que exige año y km):
  // aquí el anuncio es un soporte para una foto, no el objeto de la prueba.
  const priceId = await precioDestacado7d(request);
  // Con holgura: el coste por destacado sale de un `Setting` y podría subir sin que esto se
  // entere. Un 402 a mitad de la siembra sería un rojo ilegible.
  await concederCreditos(request, userId, 2_000);

  const sembrados: AnuncioConFoto[] = [];

  for (let i = 0; i < cuantos; i++) {
    const foto = await subirFoto(request, token, `lcp-${sello}-${i}.png`);

    const title = `${marca} ${sello} ${String(i).padStart(2, '0')}`;
    const alta = await authedPost(request, '/listings', token, {
      title,
      description:
        'Anuncio sembrado para medir el Largest Contentful Paint de /busqueda con las dos ' +
        'filas de destacados y fotos reales. Ver lcp-busqueda-destacados.spec.ts.',
      // Precios distintos por anuncio para que el texto de la tarjeta no sea idéntico en las
      // ocho — no cambia nada de la medición, pero una página de ocho clones cuesta más de
      // leer cuando algo falla.
      price: 100 + i,
      type: 'PRODUCT',
      condition: 'GOOD',
      priceType: 'FIXED',
      categoryId: categoria.id,
      city: 'Madrid',
      province: 'Madrid',
      imageIds: [foto.id],
    });
    if (!alta.ok()) throw new Error(`[seed-fotos] alta ${alta.status()} ${await alta.text()}`);
    const creado = (await alta.json()) as { id: string; slug: string };

    const pub = await authedPost(request, `/listings/${creado.id}/publish`, token, {});
    if (!pub.ok()) throw new Error(`[seed-fotos] publish ${pub.status()} ${await pub.text()}`);

    const destacar = await authedPost(request, '/billing/featured-by-credits', token, {
      listingId: creado.id,
      priceId,
    });
    if (!destacar.ok()) {
      throw new Error(`[seed-fotos] destacar ${destacar.status()} ${await destacar.text()}`);
    }

    sembrados.push({ id: creado.id, slug: creado.slug, title, urlFoto: foto.url });
  }

  return sembrados;
}
