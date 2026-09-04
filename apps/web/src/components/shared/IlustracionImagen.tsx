import Image from 'next/image';
import type { IlustracionResuelta } from '@/lib/ilustraciones';

/**
 * E7 — LA ILUSTRACIÓN, PINTADA. La mitad presentacional del subsistema.
 *
 * ── POR QUÉ ESTÁ SEPARADA DE `Ilustracion` ─────────────────────────────────────────
 *
 * `Ilustracion` es un Server Component `async` (va a buscar el dato), y un componente así
 * NO se puede importar desde un componente de cliente. Pero dos de los estados vacíos
 * —`FavoritosClient` y `MisAnunciosClient`— viven en cliente porque la lista se actualiza
 * sin recargar. Esta mitad no importa nada de servidor, así que sirve a los dos: el
 * servidor la usa a través de `Ilustracion` y el cliente la recibe con el dato por prop.
 *
 * ── LAS CUATRO REGLAS DEL §8.4, TODAS AQUÍ ─────────────────────────────────────────
 *
 * 1. **`next/image` con dimensiones EXPLÍCITAS → cero CLS.** Las medidas vienen del
 *    registro, no del fichero: el hueco se reserva antes de que la imagen exista, así que
 *    el texto de debajo no salta cuando llega. Es la regla 2 de §6.2 aplicada a imágenes.
 * 2. **`loading="lazy"`, que es el valor por defecto de `next/image` y aquí se deja a
 *    propósito.** Una ilustración de estado vacío está por definición en una pantalla poco
 *    frecuente; adelantar su descarga sería pagar en la ruta caliente por algo que casi
 *    nadie ve. `priority` no se ofrece siquiera como prop: si algún día una ilustración es
 *    el LCP de una zona de impacto, esa será una decisión con nombre y no un booleano que
 *    alguien active de paso.
 * 3. **`alt` siempre, y del registro.** No es opcional en el tipo: no se puede pintar una
 *    ilustración sin texto alternativo aunque se quiera.
 * 4. **`unoptimized`**, y esto sí hay que explicarlo: los diez defaults del modelo son SVG
 *    servidos desde `/public`, y el optimizador de Next no procesa SVG —los rechaza salvo
 *    que se active `dangerouslyAllowSVG`, que abre el optimizador a SVG remotos de
 *    cualquier origen permitido—. Un SVG de 2 KB no tiene nada que optimizar, y las
 *    sustituciones del admin son imágenes pequeñas de una pantalla poco visitada. Se
 *    prefiere no encender esa opción global por una superficie que no la necesita.
 */
export function IlustracionImagen({
  ilustracion,
  className,
}: {
  /** `null` = no hay ilustración (el backend no respondió). No se pinta nada. */
  ilustracion: IlustracionResuelta | null;
  className?: string;
}) {
  if (!ilustracion) return null;

  return (
    <Image
      src={ilustracion.url}
      alt={ilustracion.alt}
      width={ilustracion.ancho}
      height={ilustracion.alto}
      className={className ?? 'h-auto w-full max-w-[200px]'}
      unoptimized
    />
  );
}
