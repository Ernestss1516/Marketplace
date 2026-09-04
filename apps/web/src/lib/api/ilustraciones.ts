import { unstable_cache } from 'next/cache';
import { apiFetch } from './client';
import {
  ILUSTRACION_IDS,
  type IlustracionResuelta,
  type IlustracionSlotId,
  type IlustracionesResueltas,
} from '../ilustraciones';

/**
 * E7 — LA LECTURA PÚBLICA DE LAS ILUSTRACIONES. Molde exacto de `branding.ts`.
 *
 * SEPARADO de un futuro `ilustraciones-admin.ts` por el mismo motivo que la marca y el
 * estilo: este módulo importa `unstable_cache`, que es **sólo de servidor**, y la pantalla
 * de admin es cliente.
 */
function getIlustraciones(): Promise<IlustracionesResueltas> {
  return apiFetch<IlustracionesResueltas>('/ilustraciones');
}

/**
 * Las diez se pintan por todo el sitio, así que la consulta no puede correr por request.
 * Molde exacto de `getCachedBranding`: UNA entrada con clave constante —`GET
 * /ilustraciones` no filtra nada—, `revalidate: 3600` como red de seguridad y no como vía
 * principal, y el tag `ilustraciones`, que el servicio tumba en cuanto un admin sustituye
 * una.
 */
const getCached = unstable_cache(() => getIlustraciones(), ['ilustraciones'], {
  revalidate: 3600,
  tags: ['ilustraciones'],
});

/**
 * ⚠ EL RESPALDO DEL RESPALDO, Y NO ES PARANOIA.
 *
 * El default del modelo ya garantiza que ningún slot llegue vacío… **siempre que el
 * backend responda**. Si no responde, `apiFetch` lanza, y sin esto una pantalla vacía
 * pasaría de «no tienes favoritos, mira este dibujo» a un error de renderizado — o sea,
 * la pantalla más inofensiva del sitio tumbada por una imagen decorativa.
 *
 * Así que el fallo se degrada al mismo sitio al que degrada todo aquí: **no se pinta la
 * ilustración y el estado vacío se ve como se veía antes de E7**, con su texto y su botón.
 * Es la doctrina de «degrada, nunca rompe» aplicada al eslabón que faltaba: el registro
 * garantiza que hay imagen, y esto garantiza que no haberla no rompe nada.
 *
 * Devuelve `null` por slot en vez de un objeto con URL vacía: una URL vacía en un
 * `next/image` es un error de runtime, y «no hay ilustración» es un estado con render
 * definido (no pintar nada).
 */
export async function getIlustracionesSeguras(): Promise<
  Record<IlustracionSlotId, IlustracionResuelta | null>
> {
  try {
    const datos = await getCached();
    // Se comprueba slot a slot en vez de confiar en la forma: la respuesta viaja por HTTP
    // y una versión desalineada del backend podría traer nueve de diez.
    return Object.fromEntries(
      ILUSTRACION_IDS.map((id) => [id, datos?.[id] ?? null]),
    ) as Record<IlustracionSlotId, IlustracionResuelta | null>;
  } catch {
    return Object.fromEntries(ILUSTRACION_IDS.map((id) => [id, null])) as Record<
      IlustracionSlotId,
      IlustracionResuelta | null
    >;
  }
}

/** Una sola, para el caso normal: una pantalla pinta un slot. */
export async function getIlustracion(
  slot: IlustracionSlotId,
): Promise<IlustracionResuelta | null> {
  return (await getIlustracionesSeguras())[slot];
}
