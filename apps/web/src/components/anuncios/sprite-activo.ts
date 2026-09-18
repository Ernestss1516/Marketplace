'use client';

import { useSyncExternalStore } from 'react';

/**
 * PREVIA EN MÓVIL (tap) — QUIÉN ESTÁ ANIMANDO, PARA QUE SEA **UNO Y NO N**.
 *
 * EL PROBLEMA QUE RESUELVE, y por qué no vale el estado local de la tarjeta. En escritorio la
 * exclusividad la regala el ratón: sólo se puede estar encima de una tarjeta a la vez, así que
 * nunca hay dos animaciones. **Un toque no se va solo.** Sin nada que coordine, tocar cinco
 * indicadores dejaría cinco sprites descargados y cinco capas animando a la vez — que es
 * exactamente el coste de la opción A que el diagnóstico descartó (`docs/diagnostico-previa-
 * video-movil.md` §2), sólo que a plazos.
 *
 * ASÍ QUE LA REGLA ES DEL CONJUNTO, NO DE LA TARJETA, y por eso vive fuera de ella: activar una
 * apaga la anterior. Una tarjeta sola no puede saber que otra está animando.
 *
 * UN MÓDULO CON `useSyncExternalStore` Y NO UN CONTEXTO, y la razón es el rendimiento otra vez:
 * un provider re-renderizaría **las 24 tarjetas** de la parrilla en cada toque, cuando lo que
 * cambia es el estado de dos (la que se enciende y la que se apaga). Con un store externo, cada
 * tarjeta se suscribe a su propia respuesta booleana y sólo re-renderiza si ESA respuesta
 * cambia.
 *
 * NO PERSISTE NADA. Al navegar, el módulo se recarga con `null` y ninguna tarjeta nace animando
 * — que es el estado correcto: la previa es siempre una petición del usuario, nunca un
 * arrastre de la pantalla anterior.
 */

/** El id de la única tarjeta cuya previa está encendida. `null` = ninguna, que es lo normal. */
let activo: string | null = null;

const suscriptores = new Set<() => void>();

function emitir() {
  for (const avisar of suscriptores) avisar();
}

/**
 * Enciende esta tarjeta y apaga cualquier otra. Si ya estaba encendida, la apaga: **es el
 * toggle**, y es lo que hace que el segundo toque devuelva la foto sin tener que salir de la
 * tarjeta — en táctil no existe «salir», así que sin esto la única forma de apagar sería
 * encender otra.
 */
export function alternarSpriteActivo(id: string) {
  activo = activo === id ? null : id;
  emitir();
}

/**
 * Suelta el turno si lo tenía esta tarjeta. La llama el desmontaje: sin ella, una tarjeta que
 * desaparece (cambio de página, filtro nuevo) dejaría su id retenido y el siguiente toque sobre
 * la tarjeta que ocupara su sitio parecería un segundo toque — apagaría en vez de encender.
 */
export function soltarSpriteActivo(id: string) {
  if (activo === id) {
    activo = null;
    emitir();
  }
}

function suscribir(avisar: () => void) {
  suscriptores.add(avisar);
  return () => {
    suscriptores.delete(avisar);
  };
}

/**
 * ¿Es ESTA tarjeta la que está animando?
 *
 * El tercer argumento —la instantánea del servidor— es `false` **siempre**, y no es un relleno:
 * en el render del servidor no hay ningún toque que haya podido ocurrir, así que ninguna
 * tarjeta debe llegar al navegador con la capa puesta. Devolver el valor del módulo aquí sería
 * arriesgar estado compartido entre peticiones de usuarios distintos.
 */
export function useSpriteActivo(id: string): boolean {
  return useSyncExternalStore(
    suscribir,
    () => activo === id,
    () => false,
  );
}
