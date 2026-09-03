import { unstable_cache } from 'next/cache';
import { apiFetch } from './client';

/**
 * E4a — LA LECTURA DEL TEMA. Molde exacto de `branding.ts`.
 *
 * El backend devuelve el tema YA RESUELTO: un mapa `nombre de variable → valor`. El
 * frontend no sabe qué es un modelo ni cómo se deriva una paleta de cuatro colores —
 * eso es lógica de negocio y vive en Nest. Aquí sólo se trae y se pinta.
 *
 * SEPARADO de un futuro `estilo-admin.ts` por el mismo motivo que la marca: este
 * módulo importa `unstable_cache`, que es **sólo de servidor**, y la pantalla de admin
 * es cliente.
 */
export interface EstiloResuelto {
  modelo: string;
  version: string;
  tokens: Record<string, string>;
  zonas: Record<'public' | 'backoffice' | 'blog', Record<string, string>>;
  avisos: { pareja: string; ratio: number; minimo: number }[];
}

function getEstilo(): Promise<EstiloResuelto> {
  return apiFetch<EstiloResuelto>('/estilo');
}

/**
 * El tema se pinta en TODAS las páginas de todas las zonas, así que la consulta no
 * puede correr por request. Molde exacto de `getCachedBranding`: UNA entrada con clave
 * constante —`GET /estilo` no filtra nada—, `revalidate: 3600` como red de seguridad y
 * no como vía principal, y el tag `estilo`, que `EstiloService` tumba explícitamente en
 * cuanto un admin guarda una configuración nueva.
 */
export const getCachedEstilo = unstable_cache(() => getEstilo(), ['estilo'], {
  revalidate: 3600,
  tags: ['estilo'],
});

/**
 * ⚠ ESTA CACHÉ SOBREVIVE AL BUILD, Y AL VERIFICAR ENGAÑA.
 *
 * `next build` **conserva `.next/cache`** a propósito (es su caché incremental), así
 * que una entrada con `revalidate: 3600` sigue viva después de reconstruir. Se
 * descubrió peleando con una mutación de E4a: se cambiaba el azul del Modelo 0 por un
 * rojo, se reconstruía, y las 47 capturas seguían en verde — parecía que el tema no
 * llegaba a las pantallas. Llegaba; lo que llegaba era el tema ANTERIOR, servido de
 * disco. Con `rm -rf .next` delante, 45 de las 47 capturas se movieron.
 *
 * Dos consecuencias que conviene tener claras:
 *
 *  · **EN PRODUCCIÓN NO ES UN PROBLEMA**: `EstiloService` tumba el tag `estilo` en
 *    cuanto un admin guarda, así que el cambio se ve en el momento. La hora de
 *    `revalidate` es la red por si esa llamada se pierde, no la vía normal.
 *  · **AL VERIFICAR SÍ LO ES**: cualquier prueba que cambie el tema y espere ver el
 *    efecto tiene que borrar `.next` primero. Si no, mide el tema de la corrida
 *    anterior y da un verde que no significa nada.
 */

/**
 * La composición del bloque CSS vive en `lib/estilo-css.ts`, sin `next/cache`.
 *
 * No es una separación estética: importar ESTE módulo arrastra los internals de
 * servidor de Next, y un test en jsdom se cae con `TextEncoder is not defined` antes
 * de ejecutar una sola aserción. La función que compone el CSS es pura y tiene que ser
 * probable —lleva el filtro de inyección dentro—, así que vive aparte. Se reexporta
 * para que quien ya pedía las dos cosas aquí siga teniéndolas.
 */
export { bloqueDeEstilo } from '../estilo-css';
