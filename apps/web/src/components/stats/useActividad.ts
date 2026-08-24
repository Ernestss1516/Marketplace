'use client';

import { useEffect, useRef, useState } from 'react';
import type { ActividadBase, RangoEstadisticas } from '@/lib/api/admin-stats';

/**
 * ESTADÍSTICAS B1 — la carga de la actividad, una sola vez para las dos pantallas.
 *
 * Ficha de anuncio y ficha de usuario necesitan exactamente el mismo ciclo: ventana
 * seleccionada, carga, error, y recarga al cambiar de ventana. Escribirlo dos veces habría
 * garantizado que una de las dos se quedara sin el estado de error o sin cancelar la
 * respuesta obsoleta. B2 (categoría y plataforma) lo reusará igual.
 *
 * `fetcher` se guarda en una REF y no en las dependencias del efecto: quien llama lo
 * escribe como una lambda, así que su identidad cambia en cada render y ponerlo en las
 * dependencias produciría un bucle de peticiones. Lo que de verdad debe disparar una
 * recarga es el par (ventana, token), y eso es lo que está en la lista.
 *
 * La bandera `vigente` descarta la respuesta de una petición que ya no interesa: si el
 * staff pulsa 7 → 30 → 90 rápido, sin ella la respuesta de 7 podría llegar la última y
 * pintar una ventana que no es la seleccionada.
 */
export function useActividad<T extends ActividadBase>(
  fetcher: (days: RangoEstadisticas, token: string) => Promise<T>,
  token: string | undefined,
  inicial: RangoEstadisticas = 30,
) {
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
  }, [days, token]);

  return { actividad, days, setDays, loading, error };
}
