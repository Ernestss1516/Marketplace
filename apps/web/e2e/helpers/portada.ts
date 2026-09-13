import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminApiToken, authedPatch } from './api';

/**
 * La configuración de portada que siembra `apps/api/prisma/seed-test.ts`.
 *
 * FUENTE ÚNICA a propósito. Los specs de portada MUTAN una fila estática
 * compartida con toda la batería, así que tienen que dejarla como la
 * encontraron. Cuando cada uno llevaba su propia copia, la copia se quedó atrás
 * en cuanto la semilla creció (RP.4 le añadió `steps` y `grid`): los specs
 * "restauraban" una portada a la que le faltaban dos bloques, y lo que corriese
 * después medía una página distinta de la que el seed prometía.
 *
 * Si esto cambia, cambia en seed-test.ts y aquí a la vez.
 */
export const PORTADA_SEMILLA = {
  heroStaticTitle: 'Compra y vende de segunda mano',
  heroRotatingOptions: [] as string[],
  heroRotationMs: 3000,
  blocks: [
    {
      id: 'seed-search',
      type: 'search',
      eyebrow: 'Miles de anuncios cerca de ti',
      showPopularCategories: true,
      popularCount: 6,
    },
    {
      id: 'seed-cta-publicar',
      type: 'cta',
      label: '¿Tienes algo que vender? Publica gratis',
      href: '/publicar',
      style: 'outline',
    },
    {
      id: 'seed-listings',
      type: 'listings',
      title: 'Recién publicados',
      limit: 8,
      sort: 'recent',
      showAllLink: true,
    },
    {
      id: 'seed-steps',
      type: 'steps',
      title: 'Cómo funciona',
      columns: [
        {
          audienceTitle: 'Para compradores',
          icon: 'search',
          steps: [
            { title: 'Busca lo que necesitas', description: 'Usa el buscador o explora por categorías hasta encontrarlo.' },
            { title: 'Contacta con el vendedor', description: 'Pregunta tus dudas por mensajería interna, sin dar tu teléfono.' },
            { title: 'Queda y valora', description: 'Cierra el trato en persona y deja tu opinión al vendedor.' },
          ],
          cta: { label: 'Buscar ahora →', href: '/busqueda' },
        },
        {
          audienceTitle: 'Para vendedores',
          icon: 'upload',
          steps: [
            { title: 'Publica gratis', description: 'Sube fotos y describe tu artículo en un par de minutos.' },
            { title: 'Gestiona tus mensajes', description: 'Responde a los interesados desde tu bandeja de mensajes.' },
            { title: 'Destaca tu anuncio (opcional)', description: 'Dale más visibilidad si quieres vender más rápido.' },
          ],
          cta: { label: 'Publicar anuncio →', href: '/publicar' },
        },
      ],
    },
    {
      id: 'seed-trust',
      type: 'grid',
      columns: 4,
      items: [
        { media: { kind: 'icon', name: 'shield-check' }, title: 'Anuncios moderados' },
        { media: { kind: 'icon', name: 'message-circle' }, title: 'Mensajería sin compartir tu teléfono' },
        { media: { kind: 'icon', name: 'star' }, title: 'Valoraciones entre usuarios' },
        { media: { kind: 'icon', name: 'sparkles' }, title: 'Publicar es gratis' },
      ],
    },
  ] as unknown[],
};

/** Deja la portada exactamente como la sembró el seed. */
export async function restaurarPortada(request: APIRequestContext): Promise<void> {
  const res = await authedPatch(request, '/admin/homepage', adminApiToken(), PORTADA_SEMILLA);
  expect(res.status(), await res.text()).toBe(200);
}

/**
 * ══ ESCAPARATE · RÁFAGA B — LA PORTADA QUE MIDEN LAS REDES ═══════════════════════════
 *
 * Ver `docs/diseno-escaparate.md` §3.2. Es la portada con la que se toman **la captura
 * visual y el árbol de la invariancia**, y existe por una sola razón: la sembrada no se
 * puede medir.
 *
 * ── POR QUÉ NO SE MIDE LA SEMBRADA ──────────────────────────────────────────────────
 *
 * Porque lleva un bloque `listings`, y ése **no es determinista dos veces seguidas**:
 *
 *  · su contenido sale de Meilisearch, o sea de lo que haya indexado la corrida;
 *  · y su ORDEN sale de la rotación de destacados, cuyo cursor es una **ventana temporal
 *    de 15 minutos** (`FEATURED_ROTATION_WINDOW_MINUTES`, ver
 *    `docs/diseno-rotacion-destacados.md` D1). La batería funcional dura ~45 min, así que
 *    las dos lecturas de la invariancia pueden caer a distinto lado de una ventana y
 *    devolver el mismo contenido en otro orden.
 *
 * Ese rojo no diría «un modelo reorganizó»: diría «pasaron quince minutos». Y una barrera
 * que se pone roja por el reloj se acaba ignorando, que es como mueren.
 *
 * ── POR QUÉ NO SE QUITA DEL SEED, QUE SERÍA MÁS SIMPLE ──────────────────────────────
 *
 * Porque `seed-test.ts` dice, y con razón, que «la portada de test debe reproducir la
 * real, o los specs que leen la home medirían otra página». Quitarle el bloque de anuncios
 * a la portada por defecto sería romper esa promesa para arreglar un problema que sólo
 * tienen dos specs. Así que las redes **ponen la suya y restauran**, que es el contrato que
 * el resto de specs de portada ya cumple.
 *
 * ── QUÉ LLEVA, Y POR QUÉ ESO ────────────────────────────────────────────────────────
 *
 * Un bloque por IDIOMA VISUAL de los que la ráfaga C va a repintar — el mismo criterio con
 * el que la batería visual eligió sus pantallas:
 *
 *   hero (banda + titular rotativo) · search (caja + chips) · cta (el que pasa a banda) ·
 *   steps (tarjetas) · grid (tarjetas) · searchTable (pestañas + columnas de enlaces)
 *
 * `searchTable` va con la pestaña de PROVINCIAS y sólo ésa: las 52 salen de una constante
 * del frontend (`lib/provincias.ts`), así que no dependen de la base. Una pestaña de
 * categorías sí dependería, y volveríamos al problema de arriba por otra puerta.
 */
export const PORTADA_ESCAPARATE = {
  heroStaticTitle: 'Compra y vende',
  heroRotatingOptions: ['coches', 'bicicletas', 'muebles'],
  heroRotationMs: 3000,
  heroSubtitle: 'Publicar es gratis y lleva menos de un minuto.',
  blocks: [
    {
      id: 'esc-search',
      type: 'search',
      eyebrow: 'Miles de anuncios cerca de ti',
      showPopularCategories: true,
      popularCount: 6,
    },
    {
      // ESCAPARATE C — CON titular, así que este bloque se pinta como BANDA. Es el
      // camino nuevo y el que más cambia de aspecto, de modo que la captura tiene que
      // enseñarlo. El camino sin titular —el botón centrado de siempre, que es lo que
      // sigue viendo toda portada ya guardada— lo cubre el artículo de blog sembrado.
      id: 'esc-cta',
      type: 'cta',
      title: '¿Tienes algo que vender?',
      description: 'Publicar es gratis. Sin comisiones y sin intermediarios.',
      label: 'Publicar anuncio',
      href: '/publicar',
      style: 'primary',
    },
    {
      id: 'esc-steps',
      type: 'steps',
      title: 'Cómo funciona',
      columns: [
        {
          audienceTitle: 'Para compradores',
          icon: 'search',
          steps: [
            { title: 'Busca lo que necesitas', description: 'Usa el buscador o explora por categorías.' },
            { title: 'Contacta con el vendedor', description: 'Por mensajería interna, sin dar tu teléfono.' },
          ],
          cta: { label: 'Buscar ahora →', href: '/busqueda' },
        },
        {
          audienceTitle: 'Para vendedores',
          icon: 'upload',
          steps: [
            { title: 'Publica gratis', description: 'Sube fotos y describe tu artículo.' },
            { title: 'Gestiona tus mensajes', description: 'Responde desde tu bandeja.' },
          ],
          cta: { label: 'Publicar anuncio →', href: '/publicar' },
        },
      ],
    },
    {
      id: 'esc-trust',
      type: 'grid',
      columns: 4,
      items: [
        { media: { kind: 'icon', name: 'shield-check' }, title: 'Anuncios moderados' },
        { media: { kind: 'icon', name: 'message-circle' }, title: 'Mensajería sin compartir tu teléfono' },
        { media: { kind: 'icon', name: 'star' }, title: 'Valoraciones entre usuarios' },
        { media: { kind: 'icon', name: 'sparkles' }, title: 'Publicar es gratis' },
      ],
    },
    {
      id: 'esc-tabla',
      type: 'searchTable',
      title: 'Búsquedas frecuentes',
      columns: 4,
      tabs: [{ kind: 'locations', label: 'Por provincia' }],
    },
  ] as unknown[],
};

/** Pone la portada con la que se mide. Quien la llame DEBE restaurar al terminar. */
export async function ponerPortadaEscaparate(request: APIRequestContext): Promise<void> {
  const res = await authedPatch(request, '/admin/homepage', adminApiToken(), PORTADA_ESCAPARATE);
  expect(res.status(), await res.text()).toBe(200);
}

/**
 * ══ ESCAPARATE · RÁFAGA D — LA MISMA PORTADA, CON EL HERO A PANTALLA COMPLETA ════════
 *
 * Las tres piezas de la decisión 1a y la 2, juntas y en una sola captura:
 *
 *   · `heroHeight: 'pantalla'` — la banda ocupa el alto visible menos la cabecera y el
 *     asomo, para que el primer bloque se vea por abajo;
 *   · `heroEyebrow` — el rótulo que llena la parte de arriba;
 *   · `overlapHero` en el buscador — que sube y se monta sobre la banda, y que es LO QUE
 *     ASOMA. Sin él, un hero de pantalla completa con un titular solo dentro se lee como
 *     una página a medio hacer, que es justo lo que la decisión 2 descarta.
 *
 * ── POR QUÉ ESTO ES UNA CAPTURA APARTE Y NO SE CAMBIA `PORTADA_ESCAPARATE` ─────────
 *
 * Porque las dos cosas que hay que demostrar son distintas y se demuestran mejor por
 * separado:
 *
 *   1. que la ráfaga D **no cambia ninguna portada existente** — y eso se ve en que la
 *      captura `publico-portada`, que sigue en `normal`, queda IDÉNTICA. Si se hubiera
 *      cambiado esa config, esa prueba se habría perdido;
 *   2. que la pantalla completa hace lo que promete — y eso se ve aquí.
 *
 * Cuesta dos capturas más (escritorio y móvil) y compra las dos pruebas.
 */
export const PORTADA_ESCAPARATE_PANTALLA = {
  ...PORTADA_ESCAPARATE,
  heroEyebrow: 'Miles de anuncios cerca de ti',
  heroHeight: 'pantalla',
  blocks: PORTADA_ESCAPARATE.blocks.map((b) =>
    (b as { type?: string }).type === 'search' ? { ...(b as object), overlapHero: true } : b,
  ),
};

/** Pone la portada con el hero a pantalla completa. Quien la llame DEBE restaurar. */
export async function ponerPortadaPantalla(request: APIRequestContext): Promise<void> {
  const res = await authedPatch(
    request,
    '/admin/homepage',
    adminApiToken(),
    PORTADA_ESCAPARATE_PANTALLA,
  );
  expect(res.status(), await res.text()).toBe(200);
}

/**
 * Espera a que la portada refleje la variante de pantalla completa. Mismo mecanismo y
 * mismos dos cuidados que `esperarPortadaEscaparate`; lo que cambia es el marcador: aquí
 * es el RÓTULO, que la otra portada no tiene.
 */
export async function esperarPortadaPantalla(page: Page): Promise<void> {
  await expect(async () => {
    await page.goto('/', { waitUntil: 'load' });
    const visto = await page.getByText('Miles de anuncios cerca de ti').count();
    if (visto === 0) throw new Error('la portada aún no refleja PORTADA_ESCAPARATE_PANTALLA');
  }).toPass({ timeout: 30_000 });
}

/**
 * ⚠ ESPERA A QUE LA PORTADA REFLEJE LA CONFIG, Y NO ES OPCIONAL.
 *
 * `PATCH /admin/homepage` responde 200 en cuanto guarda; la invalidación del tag
 * `homepage-config` en el frontend es **fire-and-forget**. O sea que la primera visita a
 * `/` justo después del PATCH puede servirse todavía de la caché anterior.
 *
 * Sin esta espera, las dos redes fallan de formas que no se parecen entre sí y ninguna
 * apunta a la causa:
 *
 *  · la INVARIANCIA compara dos lecturas de `/`; si la primera sale de la caché vieja
 *    —con el bloque `listings` de la portada sembrada dentro— y la segunda ya no, el
 *    árbol difiere y el rojo dice «un modelo reorganizó la portada», que es mentira. Se
 *    midió: falla al correr los dos tests seguidos y pasa al correr uno solo;
 *  · la CAPTURA fotografía la portada equivocada, y el baseline queda mal tomado.
 *
 * ── LOS DOS DETALLES QUE YA COSTARON UN ROJO EN ESTE REPO ───────────────────────────
 *
 * Copiados de `esperarPortada` en `portada-bloques.spec.ts`, que los pagó antes:
 *
 *  1. `waitUntil: 'load'` y no `'domcontentloaded'`: con el segundo, la hoja de estilos
 *     puede no haberse aplicado todavía.
 *  2. El predicado usa un locator PLANO (`getByText`), nunca `getByRole`: el árbol de
 *     accesibilidad no incluye elementos sin caja de layout, que es justo lo que hay
 *     durante ese instante.
 *
 * EL MARCADOR es el título del bloque `searchTable`, y se elige porque **la portada
 * sembrada no tiene ese bloque**: si se ve, lo que hay servido es esta portada y no la
 * otra. Un marcador que existiera en las dos no distinguiría nada.
 */
export async function esperarPortadaEscaparate(page: Page): Promise<void> {
  await expect(async () => {
    await page.goto('/', { waitUntil: 'load' });
    const visto = await page.getByText('Búsquedas frecuentes').count();
    if (visto === 0) throw new Error('la portada aún no refleja PORTADA_ESCAPARATE');
  }).toPass({ timeout: 30_000 });
}
