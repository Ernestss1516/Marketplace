'use client';

import { useRef, useState } from 'react';
import { Loader2, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadTicketAttachment } from '@/lib/api/tickets';
import { cn } from '@/lib/utils';
import type { TicketAttachment } from '@/types';
import {
  ADJUNTOS_ACCEPT,
  ADJUNTOS_MAX_POR_MENSAJE,
  formatBytes,
  validarAdjuntos,
} from './attachments';

/**
 * R5 — los adjuntos de un mensaje, dentro de su burbuja.
 *
 * **No hay `<img src>` ni `<a href>` al fichero, y no es un olvido**: no existe
 * ninguna URL que apunte al objeto de R2. Cada descarga es un `fetch` autenticado
 * al endpoint que revalida el acceso (`downloadTicketAttachment`), así que la
 * única forma de mostrar el fichero es pedirlo — que es exactamente la propiedad
 * que distingue este molde del de `media`. El coste es que no se pueden pintar
 * miniaturas sin descargar; se acepta a cambio de que un adjunto nunca sea un
 * enlace que se pueda reenviar.
 */
export function AttachmentList({
  ticketId,
  attachments,
  token,
  scope = 'user',
  className,
}: {
  ticketId: string;
  attachments: TicketAttachment[];
  token: string;
  scope?: 'user' | 'staff';
  className?: string;
}) {
  const [bajando, setBajando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (attachments.length === 0) return null;

  async function handleDownload(a: TicketAttachment) {
    if (bajando) return;
    setBajando(a.id);
    setError(null);
    try {
      await downloadTicketAttachment(ticketId, a, token, scope);
    } catch {
      setError('No se pudo descargar el fichero.');
    } finally {
      setBajando(null);
    }
  }

  return (
    <div className={cn('mt-2 space-y-1', className)} data-testid="adjuntos-mensaje">
      {attachments.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => handleDownload(a)}
          disabled={bajando !== null}
          className="flex w-full items-center gap-2 rounded border border-current/20 bg-background/50 px-2 py-1 text-left text-xs text-foreground hover:bg-background/80 disabled:opacity-60"
          data-testid="adjunto-descargar"
        >
          {bajando === a.id ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <Paperclip className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">{a.filename}</span>
          <span className="ml-auto shrink-0 text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
        </button>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Selector de ficheros de la caja de respuesta.
 *
 * Valida en cuanto se eligen (tipo, tamaño y cantidad) para no hacer esperar al
 * usuario a una subida que el backend va a rechazar — pero **la validación de
 * verdad es la del servidor**: si se fuerza la petición, responde 422 y el hilo
 * muestra ese mensaje. La UI restringe, el backend garantiza.
 */
export function AttachmentPicker({
  files,
  onChange,
  disabled,
  testId = 'adjuntos-picker',
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const elegidos = [...(e.target.files ?? [])];
    // El input se resetea SIEMPRE: si no, volver a elegir el mismo fichero no
    // dispara `change` y parece que la aplicación lo ignora.
    if (inputRef.current) inputRef.current.value = '';
    if (elegidos.length === 0) return;

    const juntos = [...files, ...elegidos];
    const motivo = validarAdjuntos(juntos);
    if (motivo) {
      setError(motivo);
      return;
    }
    setError(null);
    onChange(juntos);
  }

  function quitar(idx: number) {
    setError(null);
    onChange(files.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-1" data-testid={testId}>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ADJUNTOS_ACCEPT}
        onChange={handlePick}
        disabled={disabled}
        className="hidden"
        data-testid={`${testId}-input`}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || files.length >= ADJUNTOS_MAX_POR_MENSAJE}
          onClick={() => inputRef.current?.click()}
          data-testid={`${testId}-boton`}
        >
          <Paperclip className="mr-2 h-4 w-4" />
          Adjuntar
        </Button>
        <span className="text-xs text-muted-foreground">
          JPG, PNG, WebP o PDF · máx. 10 MB · hasta {ADJUNTOS_MAX_POR_MENSAJE} ficheros
        </span>
      </div>

      {files.length > 0 && (
        <ul className="space-y-1" data-testid={`${testId}-lista`}>
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-2 rounded border bg-muted/40 px-2 py-1 text-xs"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{f.name}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">{formatBytes(f.size)}</span>
              <button
                type="button"
                onClick={() => quitar(i)}
                disabled={disabled}
                aria-label={`Quitar ${f.name}`}
                className="shrink-0 rounded p-0.5 hover:bg-background"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert" data-testid={`${testId}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
