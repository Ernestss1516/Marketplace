'use client';

import { ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * COOKIES RÁFAGA 1 — LO QUE SE VE DONDE IRÍA UN TERCERO SIN CONSENTIMIENTO.
 *
 * Ver docs/diseno-consentimiento-cookies.md §1.6.
 *
 * ─── CERO BYTES DEL TERCERO, Y ESO INCLUYE LA MINIATURA ─────────────────────────
 *
 * No lleva el póster del vídeo, y no es una decisión de estilo: `VideoBlock` guarda
 * SÓLO `{provider, videoId}` (`types/blocks.ts:70-74`), no hay póster almacenado.
 * Conseguir la miniatura significaría pedírsela a `img.youtube.com` o a la API de Vimeo
 * — **volver a contactar al tercero, que es exactamente lo que este marcador impide**.
 * Un marcador que llama al tercero para decorarse no marca nada.
 *
 * ─── Y NO PUEDE SER UN CARTEL TRISTE ────────────────────────────────────────────
 *
 * Esto es lo que ve quien rechaza. Si es feo, el efecto práctico es presionar para
 * aceptar — que es, con nombre y apellidos, lo que el RGPD llama consentimiento no
 * libre. Va con los tokens del sistema de estilo, como cualquier otra superficie.
 *
 * ─── LAS DOS ACCIONES SON DISTINTAS A PROPÓSITO ─────────────────────────────────
 *
 * «Cargar solo esta vez» NO escribe nada: vale para este contenido y esta visita. Es la
 * opción que permite ver un vídeo suelto sin quedar consintiendo todos los terceros del
 * sitio para los próximos seis meses, y su existencia es lo que hace que la otra sea una
 * elección de verdad.
 */
export function MarcadorTercero({
  proveedor,
  descripcion,
  className,
  onCargarUnaVez,
  onPermitirSiempre,
  testId,
}: {
  /** El nombre del tercero, tal cual. Sin nombre no hay consentimiento informado. */
  proveedor: string;
  /** Qué es esto ("Este vídeo", "El mapa") — para que la frase se lea natural. */
  descripcion: string;
  /**
   * Las clases del CONTENIDO QUE SUSTITUYE, no las que le apetezcan a este componente:
   * el marcador tiene que ocupar exactamente el mismo espacio o habrá salto al cargar.
   */
  className?: string;
  onCargarUnaVez: () => void;
  onPermitirSiempre: () => void;
  testId?: string;
}) {
  return (
    <div
      // `group` y no `alertdialog`: informa y ofrece, no interrumpe ni atrapa el foco.
      role="group"
      aria-label={`${descripcion} está retenido hasta que des tu consentimiento`}
      data-testid={testId}
      className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/40 p-6 text-center ${className ?? ''}`}
    >
      <ShieldOff className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />

      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {descripcion} se carga desde {proveedor}
        </p>
        {/* El QUÉ IMPLICA, en una línea. Es la mitad del consentimiento informado: sin
            esto el usuario acepta un nombre propio, no un tratamiento. */}
        <p className="text-xs text-muted-foreground">
          Al cargarlo se transfiere tu dirección IP a {proveedor}, que puede usar cookies
          propias.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCargarUnaVez}>
          Cargar solo esta vez
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onPermitirSiempre}>
          Permitir contenido de terceros
        </Button>
      </div>
    </div>
  );
}

/**
 * EL AVISO DE D3 — lo que acompaña a un mapa que cargó porque el usuario lo pidió.
 *
 * D3 dice que pulsar «Mapa» ES consentir MapTiler. Cargar sin banner no puede significar
 * cargar sin informar: **sin este aviso, D3 sería una exención silenciosa**, que es justo
 * lo que la decisión no autoriza. Con él, el usuario sabe qué acaba de pasar y quién ha
 * recibido su IP.
 *
 * Permanente y no un toast: el toast se va, y la información tiene que seguir ahí
 * mientras el contenido del tercero siga cargado.
 *
 * En RÁFAGA 3 gana un enlace a la página de cookies. Hoy no lo lleva porque esa página
 * todavía no existe, y enlazar a un 404 sería peor que no enlazar.
 */
export function AvisoTerceroCargado({ proveedor, testId }: { proveedor: string; testId?: string }) {
  return (
    <p
      role="note"
      data-testid={testId}
      className="mt-2 rounded-md border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground"
    >
      Este contenido se sirve desde {proveedor}: al usarlo se transfiere tu dirección IP.
    </p>
  );
}
