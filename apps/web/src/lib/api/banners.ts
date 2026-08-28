import { apiFetch } from './client';

/**
 * Espejo del enum `BannerPlacement` del backend — el frontend no tiene Prisma,
 * igual que `NavPageType` en lib/api/nav.ts.
 *
 * LOS GRUPOS SON LA FUENTE Y EL TIPO SE DERIVA DE ELLOS, no al revés. Escrito al
 * derecho (tipo declarado a mano + una lista aparte para el selector) un valor
 * nuevo podía quedarse fuera del selector del admin sin que nada fallara: sería
 * un placement que existe, que el backend acepta y que ningún admin puede marcar.
 * Derivándolo, eso no compila.
 *
 * El corte público / cuenta no es decorativo: es la primera pregunta que se hace
 * quien crea un banner («¿esto es para visitantes o para gente con cuenta?»), y
 * es el mismo corte con el que se agrupan las casillas del formulario.
 *
 * NOTIFICACIONES no está a propósito — ver el comentario del enum en
 * schema.prisma y docs/diseno-banners-ubicaciones.md §4.3.
 */
const PUBLIC_PLACEMENTS = [
  'HOME',
  'BUSQUEDA',
  'CATEGORIA',
  'ANUNCIO',
  'BLOG',
  'VENDEDOR',
  'PLANES',
  'CONTACTO',
] as const;

const ACCOUNT_PLACEMENTS = [
  'MIS_ANUNCIOS',
  'PERFIL',
  'PERFIL_FACTURACION',
  'PERFIL_SUSCRIPCION',
  'MIS_ALERTAS',
  'MIS_CREDITOS',
] as const;

export type BannerPlacement =
  | (typeof PUBLIC_PLACEMENTS)[number]
  | (typeof ACCOUNT_PLACEMENTS)[number];

export type BannerVariant = 'INFO' | 'PROMO' | 'WARNING';

/**
 * Etiqueta de cara al admin, una por ubicación.
 *
 * `Record<BannerPlacement, string>` Y NO `Record<string, string>`: con el tipo
 * ancho —que es lo que había— olvidar la etiqueta de un valor nuevo no rompía
 * nada, sólo pintaba `PERFIL_FACTURACION` en crudo en el backoffice detrás de un
 * `?? p`. Con dos ubicaciones eso era inofensivo; con catorce es una fuga
 * garantizada. Así, el olvido no compila y el `?? p` sobra.
 *
 * Los nombres COINCIDEN con los del selector de `/admin/nav` (Portada, Ficha de
 * anuncio, Perfil de vendedor…): son las mismas páginas, y que dos pantallas del
 * backoffice las llamaran distinto era parte de lo que esta ráfaga consolida.
 *
 * MIS_CREDITOS se etiqueta «Mi saldo» aunque su ruta sea /mis-creditos: el valor
 * del enum nombra la ruta, la etiqueta nombra lo que el usuario lee en pantalla
 * (ver la nota de mis-creditos/page.tsx sobre por qué la URL se queda).
 */
export const PLACEMENT_LABELS: Record<BannerPlacement, string> = {
  HOME: 'Portada',
  BUSQUEDA: 'Búsqueda',
  CATEGORIA: 'Categoría',
  ANUNCIO: 'Ficha de anuncio',
  BLOG: 'Blog',
  VENDEDOR: 'Perfil de vendedor',
  PLANES: 'Planes',
  CONTACTO: 'Contacto',
  MIS_ANUNCIOS: 'Mis anuncios',
  PERFIL: 'Mi perfil',
  PERFIL_FACTURACION: 'Datos de facturación',
  PERFIL_SUSCRIPCION: 'Mi suscripción',
  MIS_ALERTAS: 'Mis alertas',
  MIS_CREDITOS: 'Mi saldo',
};

/** Los dos grupos del selector del admin, en el orden en que se pintan. */
export const PLACEMENT_GROUPS: readonly {
  label: string;
  values: readonly BannerPlacement[];
}[] = [
  { label: 'Páginas públicas', values: PUBLIC_PLACEMENTS },
  { label: 'Zona de cuenta', values: ACCOUNT_PLACEMENTS },
];

/** Las catorce, en orden de grupo — para el filtro del listado y el resumen de celda. */
export const ALL_PLACEMENTS: readonly BannerPlacement[] = [
  ...PUBLIC_PLACEMENTS,
  ...ACCOUNT_PLACEMENTS,
];

export interface Banner {
  id: string;
  title: string;
  text: string;
  linkUrl: string | null;
  linkText: string | null;
  placements: BannerPlacement[];
  variant: BannerVariant;
  shareable: boolean;
  shareText: string | null;
  active: boolean;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /banners?placement=... — público, sin auth (la home es pública).
 *
 * SIN `unstable_cache`, a diferencia del nav y del footer, y es una decisión: un
 * banner tiene ventana temporal (`startsAt`/`endsAt`) y NADIE dispara un evento
 * cuando el reloj entra en ella. Con una entrada cacheada una hora, un banner
 * programado para las 09:00 podría no salir hasta las 10:00, y uno que termina a
 * las 18:00 seguiría visible después. Lo temporal se evalúa en el momento.
 *
 * Que eso no cueste una consulta por página se lo debemos al `await auth()` del
 * layout raíz: todo el árbol ya se renderiza por petición (ver la nota de
 * lib/api/homepage.ts), así que aquí no se pierde ninguna estática que existiera.
 */
export function getActiveBanners(placement: BannerPlacement): Promise<Banner[]> {
  return apiFetch<Banner[]>(`/banners?placement=${placement}`);
}
