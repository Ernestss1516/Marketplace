'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AlertCircle } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import { getIlustracionesAdmin, type EstadoIlustraciones } from '@/lib/api/ilustraciones-admin';
import type { IlustracionesResueltas } from '@/lib/ilustraciones';
import { SlotDeIlustracion } from './_components/SlotDeIlustracion';
import { SesionNoDisponible } from '@/app/(admin)/components/SesionNoDisponible';

/**
 * LAS ILUSTRACIONES — `/admin/ilustraciones`. Solo ADMIN.
 *
 * QUÉ RESUELVE. Los estados vacíos y las confirmaciones traen una imagen del modelo
 * activo; aquí una instancia puede poner la suya. Es la misma idea que los tres logos —
 * el código trae un valor por defecto y el admin lo sustituye— aplicada a las diez
 * superficies del registro de E7.
 *
 * PANTALLA PROPIA Y NO UNA PESTAÑA DE `/admin/marca`. Las dos cosas son «el aspecto de
 * esta instancia», pero la marca son tres logos y esto son diez slots con
 * previsualización doble: meterlos juntos haría una pantalla que no se puede recorrer. La
 * navegación del backoffice ya agrupa las dos bajo Plataforma.
 *
 * DIEZ TARJETAS IGUALES Y NINGÚN BOTÓN DE «GUARDAR», como en la marca: cada subida es una
 * operación completa en el servidor (sube el fichero, escribe el ajuste, limpia la
 * anterior y revalida la caché del sitio). No hay borrador que confirmar, así que un botón
 * de guardar sólo podría mentir sobre cuándo pasan las cosas.
 *
 * SE REPUEBLA CON LA RESPUESTA, no con lo que se mandó: los endpoints devuelven las diez
 * resueltas, así que sustituir una repinta el estado real de todas.
 *
 * Ver `docs/diseno-sistema-estilo.md` §8.
 */
export default function AdminIlustracionesPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [estado, setEstado] = useState<EstadoIlustraciones | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setEstado(await getIlustracionesAdmin(token));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error al cargar las ilustraciones',
      );
    }
  }, [token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function alCambiar(resueltas: IlustracionesResueltas) {
    setEstado((previo) => (previo ? { ...previo, resueltas } : previo));
  }

  if (!token) return <SesionNoDisponible />;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ilustraciones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Las imágenes de los estados vacíos y las confirmaciones. Cada una trae la del
          modelo activo; aquí puedes poner la de esta instancia. No hace falta subir nada:
          sin sustituir, todas tienen imagen.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!estado && !error && (
        <p className="text-sm text-muted-foreground">Cargando ilustraciones…</p>
      )}

      {estado && (
        <div className="grid gap-4 md:grid-cols-2">
          {estado.catalogo.map((slot) => (
            <SlotDeIlustracion
              key={slot.id}
              slot={slot}
              resuelta={estado.resueltas[slot.id]}
              token={token}
              onChange={alCambiar}
            />
          ))}
        </div>
      )}
    </div>
  );
}
