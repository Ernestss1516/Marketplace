'use client';

import { useRef, useState } from 'react';
import { AlertCircle, Loader2, Upload } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/layout/BrandLogo';
import { ApiError } from '@/lib/api/client';
import type { BrandingLogos } from '@/lib/api/branding';
import { clearBrandingLogo, uploadBrandingLogo, type LogoZone } from '@/lib/api/branding-admin';
import { resolveBrand } from '@/lib/brand';
import { useApiAction } from '@/lib/api/use-api-action';

/** Los formatos que acepta el endpoint de marca (mapa MIME propio de L1) + el tope. */
const ACEPTA = 'image/png,image/webp,image/svg+xml,image/jpeg';
const MAX_KB = 1024;

export interface ZonaInfo {
  zone: LogoZone;
  titulo: string;
  /** Qué parte de la plataforma usa este logo. */
  donde: string;
}

/**
 * TRES LOGOS L2 — una zona de marca: previsualizar, subir y quitar.
 *
 * LA PREVISUALIZACIÓN ES LA MARCA RESUELTA, no la URL cruda, y ésa es la decisión de
 * esta pantalla: se pinta **con el mismo `resolveBrand` y el mismo `BrandLogo` que la
 * cabecera de verdad**. Así, cuando una zona no tiene logo propio, aquí se ve
 * exactamente lo que se ve en la cabecera —el logo público, o el texto— en vez de un
 * hueco que no informa de nada. Es la diferencia entre «no has subido nada» y «esto es
 * lo que está viendo la gente».
 */
export function ZonaDeMarca({
  info,
  logos,
  token,
  onChange,
}: {
  info: ZonaInfo;
  logos: BrandingLogos;
  token: string;
  onChange: (logos: BrandingLogos) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { run } = useApiAction();

  const propio = logos[info.zone];
  const marca = resolveBrand(info.zone, logos);
  // De dónde sale lo que se está viendo. Sin logo propio, la cadena de respaldo ya ha
  // decidido: o el logo público, o el nombre. Decirlo evita la lectura equivocada de
  // «ya tiene logo» cuando lo que se ve es el de otra zona.
  const origen = propio
    ? 'Logo propio de esta zona.'
    : marca.src
      ? 'Sin logo propio: se está mostrando el logo público.'
      : `Sin logo: se muestra «${marca.text}».`;

  function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcupado(true);
    setError(null);
    void run(() => uploadBrandingLogo(info.zone, file, token), {
      successMessage: `Logo de ${info.titulo.toLowerCase()} actualizado.`,
      onSuccess: (nuevos) => onChange(nuevos),
      onError: (err) =>
        setError(err instanceof ApiError ? err.message : 'No se ha podido subir el logo.'),
    }).finally(() => {
      setOcupado(false);
      // Sin esto, elegir DOS VECES el mismo fichero no dispara `change` y el segundo
      // intento —tras un error, típicamente— no haría nada.
      if (fileRef.current) fileRef.current.value = '';
    });
  }

  function quitar() {
    setOcupado(true);
    setError(null);
    void run(() => clearBrandingLogo(info.zone, token), {
      successMessage: `Logo de ${info.titulo.toLowerCase()} quitado.`,
      onSuccess: (nuevos) => onChange(nuevos),
      onError: (err) =>
        setError(err instanceof ApiError ? err.message : 'No se ha podido quitar el logo.'),
    }).finally(() => setOcupado(false));
  }

  return (
    <section className="space-y-3 rounded-md border p-4" data-testid={`zona-${info.zone}`}>
      <div>
        <h2 className="text-sm font-semibold">{info.titulo}</h2>
        <p className="text-xs text-muted-foreground">{info.donde}</p>
      </div>

      {/* Sobre fondo claro y sobre fondo oscuro: un logo con el fondo equivocado se
          descubre aquí y no en producción. */}
      <div className="grid grid-cols-2 gap-2">
        {(['bg-background', 'bg-slate-900'] as const).map((fondo) => (
          <div
            key={fondo}
            className={`flex h-20 items-center justify-center rounded border ${fondo}`}
          >
            <BrandLogo
              mark={marca}
              className={`text-sm font-bold ${fondo === 'bg-background' ? '' : 'text-white'}`}
              imgClassName="max-h-12 w-auto max-w-[160px] object-contain"
            />
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground" data-testid={`origen-${info.zone}`}>
        {origen}
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
              <Upload className="mr-2 h-4 w-4" /> {propio ? 'Cambiar logo' : 'Subir logo'}
            </>
          )}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={ACEPTA}
          className="hidden"
          onChange={subir}
          data-testid={`input-${info.zone}`}
        />

        {/* SÓLO si hay logo PROPIO: quitar el de otra zona desde aquí sería quitarle el
            suyo a esa otra sin decirlo. */}
        {propio && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" size="sm" disabled={ocupado}>
                Quitar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Quitar el logo de {info.titulo.toLowerCase()}?</AlertDialogTitle>
                {/* La regla de `apps/web/CLAUDE.md`: acción irreversible ⇒ confirmación
                    antes. Y ésta lo es de verdad — al quitarlo, el fichero se borra del
                    almacenamiento y habría que volver a subirlo. */}
                <AlertDialogDescription>
                  El fichero se borra y esta zona vuelve a su respaldo. Para recuperarlo
                  habría que volver a subirlo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={quitar}>Quitar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        <span className="text-xs text-muted-foreground">
          PNG, WebP, SVG o JPEG · hasta {MAX_KB} KB
        </span>
      </div>

      {error && (
        <p
          className="flex items-center gap-1 text-sm text-destructive"
          data-testid={`error-${info.zone}`}
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
    </section>
  );
}
