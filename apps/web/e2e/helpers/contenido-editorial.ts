/**
 * ══ ESCAPARATE · RÁFAGA B — LAS RUTAS DEL CONTENIDO SEMBRADO ═════════════════════════
 *
 * Los dos `Post` que siembra `apps/api/prisma/seed-playwright.ts` (ver
 * `seedContenidoEditorial`, y `docs/diseno-escaparate.md` §3.2): un artículo de blog y
 * una página informativa, los dos PUBLICADOS y deterministas.
 *
 * ── POR QUÉ ESTO ES UN FICHERO Y NO UNA CADENA EN CADA SPEC ─────────────────────────
 *
 * Por la lección que ya dejó escrita `helpers/portada.ts`: cuando cada spec llevaba su
 * propia copia de lo sembrado, la copia se quedó atrás en cuanto la semilla creció, y los
 * specs pasaron a medir una página que el seed ya no prometía. **Una fuente, ninguna
 * copia** — y si estos slugs cambian, cambian en el seed y aquí a la vez.
 *
 * Las rutas se construyen aquí y no en el spec por lo mismo: `/blog/{slug}` y
 * `/paginas/{slug}` son el contrato de `Post.type` (POST → blog, PAGE → páginas), y ese
 * reparto merece estar dicho en un sitio.
 */

/** Artículo del blog. `Post.type = POST`. */
export const BLOG_SLUG = 'guia-comprar-bici-segunda-mano';

/** Página informativa. `Post.type = PAGE`. */
export const PAGINA_SLUG = 'como-comprar-con-seguridad';

export const RUTA_BLOG = `/blog/${BLOG_SLUG}`;
export const RUTA_PAGINA = `/paginas/${PAGINA_SLUG}`;

/**
 * El nombre de la FICHA que el artículo lleva al final (bloque `profile`, `art-ficha`).
 *
 * Vive aquí por el mismo motivo que los slugs: lo comparten la invariancia —que lo usa
 * como marcador para no comparar dos árboles que no traen la ficha— y las capturas por
 * modelo, que esperan a que esté pintada antes de disparar. Si cambia en el seed, cambia
 * aquí y los dos se enteran.
 */
export const NOMBRE_FICHA = 'Marta Ruiz';
