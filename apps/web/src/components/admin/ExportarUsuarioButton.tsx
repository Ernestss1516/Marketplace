'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { API_URL } from '@/config';
import { toUserMessage } from '@/lib/api/client';
import { getUserExports, requestUserExport } from '@/lib/api/admin';
import type { DataExportDto } from '@/lib/api/usuarios';

/**
 * BORRADO DE CUENTAS C6 — el staff exporta los datos de un usuario (§7.4).
 *
 * ── DOS BOTONES Y NO UNO, PORQUE SON DOS MOMENTOS ───────────────────────────
 *
 * Pedir y descargar están separados por el tiempo que tarda la cola. Un único
 * botón «Exportar» que a veces pide y a veces descarga tendría dos significados
 * según un estado que no se ve, y eso es exactamente lo que hace que alguien
 * pulse dos veces y acabe con un 409.
 *
 * ── SE CONSULTA AL ABRIR, NO AL PINTAR LA TABLA ─────────────────────────────
 *
 * El estado de la exportación se carga cuando el ADMIN toca este botón, no en el
 * listado: una consulta por fila multiplicaría por veinticuatro el coste de una
 * pantalla que casi nunca se usa para esto.
 *
 * La descarga va con el token en la cabecera (molde `FacturasPanel`), porque el
 * ZIP no tiene URL pública ni puede tenerla.
 */
export function ExportarUsuarioButton({
  token,
  userId,
}: {
  token: string;
  userId: string;
}) {
  const [actual, setActual] = useState<DataExportDto | null>(null);
  const [cargando, setCargando] = useState(false);

  const refrescar = async (): Promise<DataExportDto | null> => {
    const filas = await getUserExports(token, userId);
    const primera = filas[0] ?? null;
    setActual(primera);
    return primera;
  };

  const pedir = async () => {
    setCargando(true);
    try {
      // Se mira antes de pedir: si ya hay una viva, el backend devolvería 409 y
      // el ADMIN vería un error donde en realidad hay un fichero esperándole.
      const previa = await refrescar();
      if (previa && (previa.status === 'PENDING' || previa.status === 'READY')) {
        toast.info(
          previa.status === 'READY'
            ? 'Ya hay una exportación lista para este usuario.'
            : 'Ya hay una exportación en preparación para este usuario.',
        );
        return;
      }
      await requestUserExport(token, userId);
      await refrescar();
      toast.success('Exportación solicitada. Estará lista en unos minutos.');
    } catch (err) {
      toast.error(toUserMessage(err));
    } finally {
      setCargando(false);
    }
  };

  const descargar = async () => {
    if (!actual) return;
    setCargando(true);
    try {
      const res = await fetch(`${API_URL}/exports/${actual.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `exportacion-${userId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('No se pudo descargar. Puede que haya caducado.');
    } finally {
      setCargando(false);
    }
  };

  if (actual?.status === 'READY') {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={cargando}
        onClick={() => void descargar()}
      >
        {cargando ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <>
            <Download className="mr-1 h-3 w-3" />
            Descargar datos
          </>
        )}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 px-2 text-xs"
      disabled={cargando}
      onClick={() => void pedir()}
    >
      {cargando ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Exportar datos'}
    </Button>
  );
}
