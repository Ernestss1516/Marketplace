'use client';

import { useState } from 'react';
import { Download, Loader2, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { API_URL } from '@/config';
import { toUserMessage } from '@/lib/api/client';
import {
  getMyExports,
  requestMyExport,
  type DataExportDto,
} from '@/lib/api/usuarios';
import { useApiAction } from '@/lib/api/use-api-action';

/**
 * BORRADO DE CUENTAS C6 — «llévate tus datos», desde `/perfil`.
 *
 * ── POR QUÉ NO ES UN BOTÓN QUE DESCARGA ─────────────────────────────────────
 *
 * Porque el ZIP no existe cuando se pulsa. Reunir una veintena de tablas y bajar
 * las fotos y las facturas del bucket tarda, así que el trabajo va por cola: lo
 * que se pulsa aquí **solicita**, y el fichero aparece después. Fingir una
 * descarga inmediata obligaría a dejar la petición abierta minutos y a que el
 * usuario no cerrara la pestaña.
 *
 * De ahí que la pantalla tenga tres estados y no uno: pedir, esperar, descargar.
 *
 * ── LA DESCARGA VA CON EL TOKEN, NO CON UN ENLACE ───────────────────────────
 *
 * Molde exacto de `FacturasPanel.handleDownload`: `fetch` con `Authorization`,
 * `blob()` y un `<a download>` sintético. Un `href` a la API no llevaría la
 * cabecera y la respuesta sería un 401 — que es justamente la propiedad que se
 * quiere, porque significa que **no hay forma de llegar al ZIP sin sesión**.
 */
export function ExportarDatosPanel({
  token,
  inicial,
}: {
  token: string;
  inicial: DataExportDto[];
}) {
  const [exportaciones, setExportaciones] = useState(inicial);
  const [pidiendo, setPidiendo] = useState(false);
  const [bajando, setBajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run } = useApiAction();

  // La última que cuenta: la primera de la lista, que viene ordenada por fecha
  // descendente. Las anteriores son historia y no habilitan nada.
  const actual = exportaciones[0];
  const viva = actual && (actual.status === 'PENDING' || actual.status === 'READY');

  const pedir = () => {
    setPidiendo(true);
    setError(null);
    void run(async () => requestMyExport(token), {
      successMessage: 'Estamos preparando tu archivo. Te avisaremos cuando esté listo.',
      onError: () => setPidiendo(false),
      onSuccess: async () => {
        setExportaciones(await getMyExports(token));
        setPidiendo(false);
      },
    });
  };

  const refrescar = async () => {
    setError(null);
    try {
      setExportaciones(await getMyExports(token));
    } catch (err) {
      setError(toUserMessage(err));
    }
  };

  async function descargar(id: string) {
    setBajando(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/exports/${id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mis-datos.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo descargar el archivo. Puede que haya caducado: vuelve a solicitarlo.');
    } finally {
      setBajando(false);
    }
  }

  return (
    <div className="space-y-4">
      {actual?.status === 'PENDING' && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span>Estamos preparando tu archivo. Te avisaremos cuando esté listo.</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => void refrescar()}>
            Comprobar
          </Button>
        </div>
      )}

      {actual?.status === 'READY' && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-success-border bg-success px-4 py-3 text-sm text-success-foreground">
          <Package className="h-4 w-4" />
          <span>
            Tu archivo está listo
            {actual.sizeBytes ? ` (${formatearTamanyo(actual.sizeBytes)})` : ''}
            {actual.expiresAt ? `. Disponible hasta el ${formatearFecha(actual.expiresAt)}` : ''}.
          </span>
          <Button type="button" size="sm" disabled={bajando} onClick={() => void descargar(actual.id)}>
            {bajando ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Descargar
          </Button>
        </div>
      )}

      {actual?.status === 'FAILED' && (
        <div className="rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
          La última exportación no se pudo completar. Puedes volver a solicitarla.
        </div>
      )}

      {/*
        El botón NO desaparece cuando hay una viva: se deshabilita y el aviso de
        arriba explica por qué. Un botón que se esfuma deja al usuario sin saber
        si la acción existe.
      */}
      <Button type="button" variant="outline" disabled={pidiendo || viva} onClick={pedir}>
        {pidiendo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Solicitar una copia de mis datos
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function formatearTamanyo(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
