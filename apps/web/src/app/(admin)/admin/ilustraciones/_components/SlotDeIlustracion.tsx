'use client';

import { useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import type { IlustracionResuelta, IlustracionesResueltas } from '@/lib/ilustraciones';
import {
  clearIlustracion,
  uploadIlustracion,
  type SlotIlustracion,
} from '@/lib/api/ilustraciones-admin';

/** Los formatos que acepta el endpoint (mapa MIME propio del módulo) + el tope real. */
const ACEPTA = 'image/png,image/webp,image/svg+xml,image/jpeg';
const MAX_MB = 2;

/**
 * E7 — un slot de ilustración: previsualizar, sustituir y volver al del modelo.
 *
 * LA PREVISUALIZACIÓN ES LO QUE SE ESTÁ SIRVIENDO, no la URL cruda ni el fichero que se
 * acaba de elegir — misma decisión que `ZonaDeMarca`, y por el mismo motivo: aquí hay que
 * ver **lo que está viendo la gente**. Si el slot no se ha sustituido, se ve el default
 * del modelo, que es exactamente lo que sale en la pantalla de verdad.
 *
 * SE PREVISUALIZA SOBRE DOS FONDOS. Una ilustración pensada para el lienzo blanco puede
 * desaparecer sobre uno oscuro, y un modelo puede invertir el lienzo (el de prueba de E6
 * lo hace). Que ese fallo se descubra aquí y no en producción es barato: son dos divs.
 *
 * NO HAY CAMPO DE `alt`, Y ES DELIBERADO (§8.2): el texto alternativo lo trae el registro,
 * escrito por quien conoce la pantalla. Un campo opcional en un formulario es exactamente
 * cómo se acaba con imágenes sin texto alternativo — la accesibilidad no puede depender de
 * que alguien lo rellene. Se muestra para que quien sustituye sepa qué se va a leer.
 */
export function SlotDeIlustracion({
  slot,
  resuelta,
  token,
  onChange,
}: {
  slot: SlotIlustracion;
  resuelta: IlustracionResuelta | undefined;
  token: string;
  onChange: (nuevas: IlustracionesResueltas) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { run } = useApiAction();

  const url = resuelta?.url ?? slot.defecto;
  const esDefecto = resuelta?.esDefecto ?? true;

  function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcupado(true);
    setError(null);
    void run(() => uploadIlustracion(slot.id, file, token), {
      successMessage: 'Ilustración sustituida.',
      onSuccess: (nuevas) => onChange(nuevas),
      onError: (err) =>
        setError(
          err instanceof ApiError ? err.message : 'No se ha podido subir la ilustración.',
        ),
    }).finally(() => {
      setOcupado(false);
      // Sin esto, elegir DOS VECES el mismo fichero no dispara `change` y el segundo
      // intento —tras un error, típicamente— no haría nada. Mismo apaño que en la marca.
      if (fileRef.current) fileRef.current.value = '';
    });
  }

  function restaurar() {
    setOcupado(true);
    setError(null);
    void run(() => clearIlustracion(slot.id, token), {
      successMessage: 'Ilustración restaurada a la del modelo.',
      onSuccess: (nuevas) => onChange(nuevas),
      onError: (err) =>
        setError(
          err instanceof ApiError ? err.message : 'No se ha podido restaurar la ilustración.',
        ),
    }).finally(() => setOcupado(false));
  }

  return (
    <section className="space-y-3 rounded-md border p-4" data-testid={`slot-${slot.id}`}>
      <div>
        <h2 className="text-sm font-semibold">{slot.descripcion}</h2>
        <p className="font-mono text-xs text-muted-foreground">{slot.id}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(['bg-background', 'bg-slate-900'] as const).map((fondo) => (
          <div
            key={fondo}
            className={`flex h-28 items-center justify-center rounded border ${fondo}`}
          >
            {/* `<img>` y no `next/image`: aquí la URL cambia en caliente tras cada
                subida y esto es una previsualización de backoffice, no una pantalla
                pública con presupuesto de CLS. La pantalla de verdad sí usa
                `next/image` con dimensiones. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={slot.alt}
              className="max-h-24 w-auto max-w-[180px] object-contain"
            />
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground" data-testid={`origen-${slot.id}`}>
        {esDefecto
          ? 'Sin sustituir: se muestra la del modelo.'
          : 'Sustituida para esta instancia.'}
      </p>

      <p className="text-xs text-muted-foreground">
        Texto alternativo: «{slot.alt}». Proporción recomendada: {slot.proporcion.ancho}×
        {slot.proporcion.alto}. Hasta {MAX_MB} MB.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={ocupado}
        >
          {ocupado ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Trabajando…
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" /> Sustituir
            </>
          )}
        </Button>

        {!esDefecto && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={restaurar}
            disabled={ocupado}
            data-testid={`restaurar-${slot.id}`}
          >
            Volver a la del modelo
          </Button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept={ACEPTA}
          className="hidden"
          onChange={subir}
          data-testid={`archivo-${slot.id}`}
        />
      </div>

      {error && (
        <p className="text-xs text-destructive" data-testid={`error-${slot.id}`}>
          {error}
        </p>
      )}
    </section>
  );
}
