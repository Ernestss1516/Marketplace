import { SITE_NAME } from '@/config';
// `import type`: se borra al compilar, así que este módulo NO arrastra
// `lib/api/branding.ts` —que importa `next/cache`, sólo de servidor— a los bundles
// de cliente que lo usan (la marca del blog y el drawer del backoffice).
import type { BrandingLogos } from '@/lib/api/branding';

/**
 * TRES LOGOS L2 — LA CADENA DE RESPALDO, en un módulo puro.
 *
 * FICHERO SIN JSX Y SIN `'use client'`, molde `ajustes-organizacion.ts`: lo usan una
 * cabecera de servidor (la pública), un layout de servidor (el backoffice), un
 * componente de cliente (el intercambio del blog) y un test que no monta ninguno de
 * los tres. Si la cadena viviera dentro del componente, la única forma de comprobar
 * «qué se ve cuando no hay logo» sería renderizar tres árboles distintos.
 *
 * Ver `docs/diseno-logos.md` §5 y §6.
 */

/** Las tres zonas de marca. Espejo de `LOGO_ZONES` del backend. */
export type BrandZone = 'public' | 'backoffice' | 'blog';

export interface BrandMark {
  /** La imagen que toca pintar, o `null` si en esta instancia no hay ninguna. */
  src: string | null;
  /**
   * El nombre de la marca en esta zona.
   *
   * SIRVE PARA LAS DOS COSAS —el texto de respaldo Y el `alt` de la imagen—, y es
   * deliberado: así el **nombre accesible de la cabecera es el mismo haya logo o no**.
   * Quien navega con lector de pantalla oye lo mismo en una instancia recién
   * desplegada y en una con los tres logos subidos, y las pruebas que buscan la
   * cabecera por su nombre (`shell-cuenta.spec.ts`) siguen valiendo en los dos
   * estados. (El diseño §6.3 proponía «Backoffice de {SITE_NAME}» sólo para el `alt`;
   * se unifica en una sola cadena por esto.)
   */
  text: string;
}

/**
 * El texto de cada zona. El del backoffice lleva el nombre de la instancia DELANTE, y
 * ése es el punto entero de §8: si el mismo código corre en coches.x y en motos.x, la
 * cabecera del backoffice tiene que decir en cuál estás **desde el minuto cero**, antes
 * de que nadie haya subido ningún logo. Decir «Backoffice» a secas —lo que había— no
 * distingue una instancia de otra.
 */
const TEXTO_POR_ZONA: Readonly<Record<BrandZone, string>> = {
  public: SITE_NAME,
  backoffice: `${SITE_NAME} · Backoffice`,
  blog: SITE_NAME,
};

/**
 * A qué logo mira cada zona, y en qué orden.
 *
 * BACKOFFICE Y BLOG CAEN AL LOGO PÚBLICO ANTES QUE AL TEXTO, y no es una comodidad:
 * el caso más probable el primer día es que el admin suba UN logo. Con esta cadena la
 * instancia queda coherente —imagen en las tres zonas— en vez de enseñar una imagen en
 * una y texto en las otras dos. Se pierde la diferenciación, que es lo secundario; la
 * marca, que es lo principal, no. El día que suban el segundo logo, la diferenciación
 * aparece sola.
 *
 * El público NO tiene segundo eslabón: no hay de qué caer, y una imagen genérica de
 * fábrica sería peor que su propio nombre — parecería la marca de otro.
 */
const CADENA: Readonly<Record<BrandZone, readonly BrandZone[]>> = {
  public: ['public'],
  backoffice: ['backoffice', 'public'],
  blog: ['blog', 'public'],
};

/**
 * Qué marca pintar en una zona. **Nunca devuelve nada vacío**: el último eslabón es
 * texto de una constante de build, así que no puede fallar ni depender de la red.
 *
 * `logos` puede ser `null` — es lo que llega cuando el backend no responde
 * (`.catch(() => null)` en quien lo pide). Un backend caído deja la cabecera con el
 * nombre del sitio, que es exactamente lo que había antes de esta ráfaga: degrada,
 * nunca rompe.
 */
export function resolveBrand(zone: BrandZone, logos: BrandingLogos | null | undefined): BrandMark {
  const text = TEXTO_POR_ZONA[zone];
  for (const paso of CADENA[zone]) {
    const url = logos?.[paso];
    if (url) return { src: url, text };
  }
  return { src: null, text };
}

/**
 * ¿Esta ruta es del blog? (§11.2, opción A.)
 *
 * POR SEGMENTO Y NO POR PREFIJO DE TEXTO, que es la cicatriz R4 de
 * `backoffice-sections.ts`: con un `startsWith('/blog')` pelado, una ruta futura como
 * `/blogueros` heredaría el logo del blog sin que nadie lo decidiera. Hoy no existe;
 * la clase de error sí, y cuesta lo mismo cerrarla.
 */
export function esRutaDeBlog(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === '/blog' || pathname.startsWith('/blog/');
}
