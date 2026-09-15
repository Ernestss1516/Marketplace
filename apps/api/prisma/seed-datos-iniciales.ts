import { PAGINA_COOKIES_SLUG } from './seed-pagina-cookies';

/**
 * LO QUE UNA INSTANCIA NUEVA NECESITA Y NADIE SEMBRABA.
 *
 * Ver docs/auditoria-seed.md §3.
 *
 * ─── EL HUECO, Y POR QUÉ NO SE VEÍA ─────────────────────────────────────────────
 *
 * Estos tres conjuntos —motivos de contacto, columnas del pie y barra de navegación—
 * existían en las bases ANTIGUAS porque los creó un backfill de una vez:
 * `contact-reason-backfill` y `footer-backfill`. Pero esos scripts **ya no pueden
 * correr en una base nueva**: leen columnas heredadas (`ContactMessage.motivo`,
 * `Post.showInFooter`) que sus propias migraciones borraron después
 * (`20260712123500_drop_contact_motivo_enum`, `20260711082727_drop_post_footer_fields`).
 *
 * Es decir: el dato existía en las máquinas que venían de antes y **faltaba en toda
 * instalación nueva**, que es la peor forma de faltar — invisible para quien
 * desarrolla, garantizada para quien despliega.
 *
 * ─── LOS MOTIVOS DE CONTACTO SON EL CASO GRAVE ──────────────────────────────────
 *
 * Sin una sola fila de `ContactReason`, el formulario público **se apaga solo**: no
 * enseña un desplegable vacío, se sustituye por «El formulario no está disponible en
 * este momento» (`ContactForm.tsx:106-109`). Y no es sólo la pantalla —`motivoId` es
 * obligatorio y el servicio rechaza cualquier id que no exista
 * (`ContactService.submit`)—, así que no hay forma de enviar un mensaje. Una plataforma
 * recién desplegada sin vía de contacto.
 *
 * Los seis motivos son EXACTAMENTE los del backfill, con su mismo orden: aquí no se
 * inventa producto, se mueve un dato de un script que ya no puede ejecutarse a la
 * semilla, que es donde debió estar siempre.
 *
 * ─── EL PIE Y LA BARRA SON GRAVES DE OTRA MANERA ────────────────────────────────
 *
 * Aquí sí hubo que decidir, porque el backfill no traía datos propios: los DERIVABA de
 * páginas que en una instalación nueva no existen. Los criterios:
 *
 *  · **Sólo rutas que existen** en `apps/web/src/app/(public)`. Un enlace sembrado a
 *    una ruta inventada sería un 404 de fábrica.
 *  · **Nada que el marco ya pinte.** El pie ya lleva fijos «Buscar», «Publicar»,
 *    «Acceder» y «Preferencias de cookies» (`Footer.tsx:53-63`), y la cabecera ya lleva
 *    `/busqueda` y `/publicar` (`Header.tsx:45-51`). Repetirlos sería ruido.
 *  · **Cuatro columnas**, que es exactamente lo que pinta la rejilla del pie
 *    (`md:grid-cols-4`).
 *
 * ─── LA POLÍTICA DE COOKIES SE ENLAZA AUNQUE ESTÉ EN BORRADOR, Y ES DELIBERADO ──
 *
 * El ítem del pie apunta a la página por su `slug`. Mientras siga en `DRAFT`, el pie
 * público **no lo pinta** (`FooterService.listPublicNav` filtra los `PAGE` no
 * publicados, y una columna que se queda sin ítems desaparece entera), y el backoffice
 * lo enseña con su distintivo de «en borrador».
 *
 * Así, publicar la página —el acto que dice «el texto legal ya está»— hace aparecer su
 * enlace en el pie **sin que nadie tenga que acordarse de añadirlo**. Es el mismo
 * mecanismo que ya usa `cookiePolicyUrl`, que apunta a la página desde el primer día y
 * sólo se sirve cuando está publicada.
 *
 * ─── SE MIRA SIN EJECUTAR NADA ──────────────────────────────────────────────────
 *
 * Mismo motivo que `SEED_SETTINGS` y `seed-admin.ts`: son datos, no un script. La
 * barrera los recorre y comprueba sus invariantes (rutas relativas, tipos coherentes,
 * órdenes sin repetir) sin tocar la base de datos.
 */

// ── Motivos de contacto ────────────────────────────────────────────────────────

/**
 * Los seis de `contact-reason-backfill.ts:44-51`, con su orden original.
 *
 * `scope` se deja en su valor por defecto (`PUBLIC`): es el que tenían al migrar, y
 * decidir cuáles se ofrecen además al abrir un ticket es una decisión de producto que
 * se toma desde `/admin`, no algo que una semilla deba suponer. Abrir un ticket sin
 * motivo es válido (`TicketsService.assertTopicUsableInTickets` sale pronto si no hay),
 * así que nada queda bloqueado.
 */
export const MOTIVOS_CONTACTO: { nombre: string; orden: number }[] = [
  { nombre: 'Consulta general', orden: 0 },
  { nombre: 'Problema técnico', orden: 1 },
  { nombre: 'Denuncia de contenido', orden: 2 },
  { nombre: 'Facturación', orden: 3 },
  { nombre: 'Prensa', orden: 4 },
  { nombre: 'Otro', orden: 5 },
];

// ── Pie de página ──────────────────────────────────────────────────────────────

/**
 * Un ítem del pie. `PAGE` se declara por SLUG y no por id: los ids son `cuid()` y no
 * existen hasta que la semilla crea la página, así que el dato no puede llevarlos.
 */
export type ItemPieSemilla =
  | { tipo: 'INTERNAL'; label: string; url: string }
  | { tipo: 'PAGE'; label: string; slugPagina: string };

export interface ColumnaPieSemilla {
  name: string;
  items: ItemPieSemilla[];
}

export const COLUMNAS_PIE: ColumnaPieSemilla[] = [
  {
    name: 'Comprar',
    items: [
      { tipo: 'INTERNAL', label: 'Explorar anuncios', url: '/busqueda' },
      { tipo: 'INTERNAL', label: 'Consejos para comprar', url: '/blog' },
    ],
  },
  {
    name: 'Vender',
    items: [
      { tipo: 'INTERNAL', label: 'Publicar un anuncio', url: '/publicar' },
      { tipo: 'INTERNAL', label: 'Planes y precios', url: '/planes' },
    ],
  },
  {
    name: 'Ayuda',
    items: [{ tipo: 'INTERNAL', label: 'Contacto', url: '/contacto' }],
  },
  {
    name: 'Legal',
    // Único `PAGE` de la semilla. Invisible hasta que alguien publique la política —
    // ver la nota de cabecera.
    items: [{ tipo: 'PAGE', label: 'Política de cookies', slugPagina: PAGINA_COOKIES_SLUG }],
  },
];

// ── Barra de navegación ────────────────────────────────────────────────────────

/**
 * Tres entradas planas, sin submenús y sin `visibleOn`.
 *
 * SIN `visibleOn` (`[]`) significa «en todas las páginas», que es el estado por defecto
 * del modelo y el caso mayoritario de una barra. Y planas porque un desplegable de un
 * solo nivel sembrado sería estructura sin contenido: los submenús los monta quien
 * tenga secciones que agrupar.
 *
 * Ninguna repite lo que la cabecera ya lleva fijo (`/busqueda`, `/publicar`).
 */
export const NAV_INICIAL: { label: string; url: string; order: number }[] = [
  { label: 'Blog', url: '/blog', order: 0 },
  { label: 'Planes', url: '/planes', order: 1 },
  { label: 'Contacto', url: '/contacto', order: 2 },
];
