'use client';

import { useEffect, useRef, useState } from 'react';
import type { RangoEstadisticas } from '@/lib/api/admin-stats';

/**
 * ESTADÍSTICAS B1 — la carga de la actividad, una sola vez para las dos pantallas.
 *
 * Ficha de anuncio y ficha de usuario necesitan exactamente el mismo ciclo: ventana
 * seleccionada, carga, error, y recarga al cambiar de ventana. Escribirlo dos veces habría
 * garantizado que una de las dos se quedara sin el estado de error o sin cancelar la
 * respuesta obsoleta. Y B2 lo reusa tal cual para la ficha de categoría y para el pulso de plataforma.
 *
 * `fetcher` se guarda en una REF y no en las dependencias del efecto: quien llama lo
 * escribe como una lambda, así que su identidad cambia en cada render y ponerlo en las
 * dependencias produciría un bucle de peticiones. Lo que de verdad debe disparar una
 * recarga es el par (ventana, token), y eso es lo que está en la lista.
 *
 * La bandera `vigente` descarta la respuesta de una petición que ya no interesa: si el
 * staff pulsa 7 → 30 → 90 rápido, sin ella la respuesta de 7 podría llegar la última y
 * pintar una ventana que no es la seleccionada.
 *
 * `extraKey` es para los llamantes cuya petición depende de ALGO MÁS que la ventana — hoy
 * la ficha de categoría, que puede pedir el subárbol o sólo la categoría exacta. Va en las
 * dependencias del efecto, así que cambiarlo recarga igual que cambiar la ventana. Sin
 * esto, quien lo necesitara acabaría forzando la recarga con un `key` en el componente
 * —remontarlo entero para recargar un dato— o, peor, con un `setDays(days)` que React
 * ignora por ser el mismo valor.
 */
// SIN restringir `T` a `ActividadBase`: el hook no toca ni un campo del resultado, sólo
// lo guarda. Atarlo a esa forma dejaba fuera al pulso de plataforma —que tiene totales por
// categoría en vez de los de una entidad— y habría obligado a escribir un segundo hook
// idéntico para él.
export function useActividad<T>(
  fetcher: (days: RangoEstadisticas, token: string) => Promise<T>,
  token: string | undefined,
  opciones: { inicial?: RangoEstadisticas; extraKey?: string | number | boolean } = {},
) {
  const { inicial = 30, extraKey } = opciones;
  const [days, setDays] = useState<RangoEstadisticas>(inicial);
  const [actividad, setActividad] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!token) return;
    let vigente = true;
    setLoading(true);
    setError(null);

    fetcherRef
      .current(days, token)
      .then((datos) => {
        if (vigente) setActividad(datos);
      })
      .catch((e: unknown) => {
        if (vigente) setError(e instanceof Error ? e.message : 'Error desconocido');
      })
      .finally(() => {
        if (vigente) setLoading(false);
      });

    return () => {
      vigente = false;
    };
  }, [days, token, extraKey]);

  return { actividad, days, setDays, loading, error };
}
