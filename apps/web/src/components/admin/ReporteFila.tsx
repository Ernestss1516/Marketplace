import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { adminReportHref } from '@/lib/admin-links';
import {
  ESTADO_REPORTE_LABELS,
  MOTIVO_REPORTE_LABELS,
  etiqueta,
} from '@/app/(admin)/admin/etiquetas';

/**
 * UNA DENUNCIA RESUMIDA, IGUAL EN TODAS PARTES.
 *
 * QUÉ ARREGLA. Había TRES versiones de esto, cada una con menos que la anterior:
 *
 *   · la cola de reportes: motivo, descripción, estado, denunciante y fecha;
 *   · la ficha de anuncio: motivo, estado, denunciante y fecha — **sin la
 *     descripción**, que es el texto de la queja, o sea la sustancia;
 *   · la ficha de usuario: motivo y estado, **y nada más**. Ni fecha, ni
 *     descripción, ni contra qué era, ni ningún enlace.
 *
 * Ninguna compartida, así que las tres podían divergir —y divergieron— sin que
 * nadie lo viera. Es el mismo movimiento que `ValoracionFila` hizo con las
 * valoraciones, y por el mismo motivo: dos copias divergen, tres ya han
 * divergido.
 *
 * SIEMPRE ENLAZA A LA FICHA de la denuncia, que hasta esta ráfaga no existía: por
 * eso las dos fichas mandaban a `/admin/reportes` —la lista entera— y el moderador
 * tenía que buscar la suya a mano.
 *
 * NO PINTA CONTRA QUÉ VA, a propósito: se usa dentro de la ficha del anuncio o del
 * usuario denunciado, o sea que la diana ya la sabe quien está mirando. Para eso
 * está `ReporteDiana`, que sí lo hace y vive en la cola y en la ficha.
 */
export function ReporteFila({
  reporte,
  formatearFecha,
}: {
  reporte: {
    id: string;
    reason: string;
    status: string;
    description?: string | null;
    createdAt: string;
    /** `name` puede ser null: una cuenta eliminada conserva su fila vaciada. */
    reporter?: { name: string | null } | null;
  };
  /** La fecha la formatea quien llama: cada ficha ya tiene la suya. */
  formatearFecha: (iso: string) => string;
}) {
  return (
    <li className="rounded-md border p-2 text-sm" data-testid="reporte-fila">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={adminReportHref(reporte.id)}
          className="font-medium hover:underline"
          data-testid="reporte-fila-enlace"
        >
          {etiqueta(MOTIVO_REPORTE_LABELS, reporte.reason)}
        </Link>
        <Badge variant="outline">{etiqueta(ESTADO_REPORTE_LABELS, reporte.status)}</Badge>
      </div>
      {/* LA DESCRIPCIÓN. Es lo que distingue una denuncia legítima de una represalia,
          y era justo lo que las dos fichas se callaban. */}
      {reporte.description && (
        <p className="mt-1 line-clamp-2 text-xs">{reporte.description}</p>
      )}
      <p className="mt-0.5 text-xs text-muted-foreground">
        {reporte.reporter?.name ?? 'Anónimo'} · {formatearFecha(reporte.createdAt)}
      </p>
    </li>
  );
}
