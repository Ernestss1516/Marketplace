'use client';

/**
 * FICHA F1 (P4) — LA FICHA DE DETALLE DE UN ANUNCIO EN EL BACKOFFICE.
 *
 * QUÉ ARREGLA, y no es «una pantalla más». La cola de revisión enlazaba cada
 * anuncio a `/anuncio/{slug}`, la página PÚBLICA, que lanza 404 para todo lo que
 * no sea ACTIVE. Como la cola contiene por construcción sólo PENDING_REVIEW, ese
 * enlace estaba roto el 100 % de las veces, y no existe ninguna vista previa de
 * staff: el moderador aprobaba y rechazaba sin ver la descripción ni las fotos.
 * Esta pantalla es lo que le permite ver lo que modera.
 *
 * POR QUÉ RUTA PROPIA y no un panel desplegable como el de `/admin/usuarios`:
 * porque el enlace roto necesita un DESTINO CON URL. Un panel dentro de la tabla
 * no se puede enlazar desde la cola ni desde un reporte, que es la mitad del
 * valor de esta ráfaga. Ver docs/diseno-ficha-anuncio.md §1.5 (D-1).
 *
 * PERMISOS SIN FILA NUEVA. `sectionForPath` casa por SEGMENTO, así que
 * `/admin/anuncios/{id}` pertenece ya a la sección `anuncios` y hereda su
 * `minRole: 'MODERATOR'`. Añadirle una entrada propia al mapa crearía una segunda
 * verdad sobre el mismo permiso — justo lo que la fuente única de R1 evita.
 *
 * SITIO RESERVADO. La cabecera es donde irá la etiqueta interna (P1), junto al
 * estado, porque es otro eje de clasificación del staff. Y las secciones son
 * independientes a propósito: P3a podrá activar la edición sección a sección sin
 * reescribir la pantalla.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import {
  changeListingStatus,
  deleteAdminListing,
  getAdminListing,
  setListingTriage,
  updateAdminListing,
  type AdminListingDetail,
} from '@/lib/api/admin';
import {
  TRIAGE_LABELS,
  TRIAGE_MANUAL_VALUES,
  etiquetaDeTriage,
  varianteDeTriage,
} from '../listing-triage';
import { approveListing, rejectListing } from '@/lib/api/moderacion';
import { elegirAccionDeEstado } from '../moderacion-routing';
import {
  STATUS_VARIANTS,
  TARGET_STATUSES,
  etiquetaDeEstado,
  formatDateTime,
  formatPrice,
} from '../listing-status';
import { ApiError } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** Etiquetas de las acciones registradas en la auditoría. */
const ACCION_LABELS: Record<string, string> = {
  LISTING_STATUS_CHANGE: 'Cambio de estado',
  LISTING_APPROVE: 'Aprobado',
  LISTING_REJECT: 'Rechazado',
  LISTING_DEACTIVATE: 'Desactivado',
  LISTING_RESTORE: 'Restaurado',
  LISTING_DELETE: 'Eliminado',
  // ETIQUETA INTERNA (P1) — sólo los cambios MANUALES llegan aquí. La transición
  // automática (REVIEWED→EDITED al editar el dueño) no deja registro, y su
  // «cuándo» se pinta en la insignia con `updatedAt`.
  LISTING_TRIAGE_CHANGE: 'Etiqueta interna',
  // P3a — el staff corrigió campos del anuncio. Se nombra distinto de un cambio
  // del dueño a propósito: el vendedor tiene que poder ver quién le tocó qué.
  LISTING_EDIT: 'Edición del equipo',
};

function Seccion({
  titulo,
  children,
  contador,
}: {
  titulo: string;
  children: React.ReactNode;
  contador?: number;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
        {contador !== undefined && ` (${contador})`}
      </h2>
      {children}
    </section>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{etiqueta}</span>
      <span className="text-right font-medium">{valor}</span>
    </div>
  );
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

export default function AdminFichaAnuncioPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
  // BORRADO B2 — eliminar es ADMIN-only dentro de una sección MODERATOR: es la
  // ÚNICA acción irreversible sobre un anuncio. El backend lo impone con
  // @MinRole(ADMIN); esto es que la UI no le prometa al moderador un botón que
  // le va a responder 403. Mismo criterio que `/admin/anuncios`.
  const puedeEliminar = session?.user.role === 'ADMIN';

  const [data, setData] = useState<AdminListingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nuevoEstado, setNuevoEstado] = useState('');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  // P3a — el modo edición de la sección «El anuncio».
  const [editando, setEditando] = useState(false);
  const [edTitulo, setEdTitulo] = useState('');
  const [edDescripcion, setEdDescripcion] = useState('');
  const [edPrecio, setEdPrecio] = useState('');
  const [edMotivo, setEdMotivo] = useState('');

  const cargar = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const d = await getAdminListing(token, params.id);
      setData(d);
      setNuevoEstado(d.status);
    } catch (err) {
      setError(
        err instanceof ApiError ? `Error ${err.statusCode}: ${err.message}` : 'Error al cargar',
      );
    } finally {
      setLoading(false);
    }
  }, [token, params.id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function cambiarEstado() {
    if (!token || !data || guardando || nuevoEstado === data.status) return;
    setGuardando(true);
    try {
      // MODERACIÓN M2 — LA REGLA NO SE REIMPLEMENTA AQUÍ. Aprobar y rechazar van
      // por SU endpoint, que es el único que registra `LISTING_APPROVE` /
      // `LISTING_REJECT` y avisa al vendedor. Escribir dos `if` en esta pantalla
      // en vez de llamar a la función pura reabriría exactamente el defecto que
      // M2 cerró: aprobar desde el backoffice sin que el vendedor se entere.
      const accion = elegirAccionDeEstado(data.status, nuevoEstado);
      if (accion === 'approve') {
        await approveListing(data.id, token);
      } else if (accion === 'reject') {
        await rejectListing(data.id, token, motivo || undefined);
      } else {
        await changeListingStatus(token, data.id, nuevoEstado, motivo || undefined);
      }
      setMotivo('');
      await cargar();
    } catch (err) {
      alert(
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error al cambiar el estado',
      );
    } finally {
      setGuardando(false);
    }
  }

  /**
   * ETIQUETA INTERNA (P1, E2) — el cambio manual, por SU endpoint.
   *
   * No pasa por `elegirAccionDeEstado` ni por `changeListingStatus`: no es un
   * cambio de estado. Que sea una función aparte es lo que mantiene los dos ejes
   * separados también en el código de la pantalla.
   */
  async function cambiarTriaje(cambio: { triage?: string; watched?: boolean }) {
    if (!token || !data || guardando) return;
    setGuardando(true);
    try {
      await setListingTriage(token, data.id, cambio);
      await cargar();
    } catch (err) {
      alert(
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error al cambiar la etiqueta interna',
      );
    } finally {
      setGuardando(false);
    }
  }

  /**
   * P3a — EL MODO EDICIÓN DE UNA SECCIÓN.
   *
   * Va por `PATCH /admin/listings/:id`, que es el camino del STAFF: valida lo
   * mismo que el del dueño y **no mueve el triaje**. No pasa por
   * `elegirAccionDeEstado` porque no cambia de estado — son ejes distintos.
   */
  function abrirEdicion() {
    if (!data) return;
    setEdTitulo(data.title);
    setEdDescripcion(data.description);
    setEdPrecio(String(data.price));
    setEdMotivo('');
    setEditando(true);
  }

  async function guardarEdicion() {
    if (!token || !data || guardando) return;
    setGuardando(true);
    try {
      await updateAdminListing(token, data.id, {
        title: edTitulo,
        description: edDescripcion,
        price: Number(edPrecio),
        reason: edMotivo.trim(),
      });
      setEditando(false);
      await cargar();
    } catch (err) {
      alert(
        err instanceof ApiError ? `Error ${err.statusCode}: ${err.message}` : 'Error al guardar',
      );
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!token || !data) return;
    setGuardando(true);
    try {
      await deleteAdminListing(token, data.id);
      setConfirmarBorrado(false);
      router.push('/admin/anuncios');
    } catch (err) {
      alert(
        err instanceof ApiError ? `Error ${err.statusCode}: ${err.message}` : 'Error al eliminar',
      );
      setGuardando(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando ficha...
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/anuncios"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a anuncios
        </Link>
        <div className="flex items-center gap-2 text-sm text-destructive" data-testid="ficha-error">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const señales = data.moderationSignals;
  const hayAlgunaSeñal =
    señales.usuario || señales.categoria || señales.plataforma || señales.palabraProhibida;

  return (
    <div className="space-y-4 pb-12" data-testid="ficha-anuncio">
      <Link
        href="/admin/anuncios"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Volver a anuncios
      </Link>

      {/* ── 1. Cabecera ─────────────────────────────────────────────────────
          P1 (etiqueta interna) irá aquí, junto al estado: es otro eje de
          clasificación del staff y se tiene que ver sin desplazarse. */}
      <header className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold" data-testid="ficha-titulo">
                {data.title}
              </h1>
              <Badge variant={STATUS_VARIANTS[data.status] ?? 'outline'} data-testid="ficha-estado">
                {etiquetaDeEstado(data.status)}
              </Badge>
              {data.needsRevalidation && <Badge variant="destructive">Requiere revalidación</Badge>}
            </div>

            {/* ETIQUETA INTERNA (P1, E2) — EL SITIO QUE F1 RESERVÓ, ya ocupado.
                En su PROPIA línea, debajo del estado: van juntas porque se
                consultan juntas, pero separadas porque son ejes distintos —
                `status` dice qué le pasa al anuncio, esto dice cómo lo lleva el
                staff. Que se vean distintas es parte del diseño. */}
            <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="ficha-triage">
              <span className="text-xs text-muted-foreground">Etiqueta interna:</span>
              <Badge variant={varianteDeTriage(data.triage)}>
                {etiquetaDeTriage(data.triage)}
              </Badge>
              {/* EL «CUÁNDO» DE `EDITED`, y por qué sale de `updatedAt`: la
                  transición automática no deja registro en AuditLog (E1), así
                  que el historial tendría un salto. `updatedAt` es el dato
                  exacto de cuándo el dueño lo cambió — se pinta eso en vez de
                  inventar una fila de historial. */}
              {data.triage === 'EDITED' && (
                <span className="text-xs text-muted-foreground" data-testid="ficha-triage-cuando">
                  el {formatDateTime(data.updatedAt)}
                </span>
              )}
              {data.watched && (
                <Badge variant="secondary" data-testid="ficha-watched">
                  En observación
                </Badge>
              )}
            </div>
            <p className="mt-1 text-lg font-medium" data-testid="ficha-precio">
              {formatPrice(data.price, data.currency, data.priceType)}
            </p>
            {/* La RUTA de la categoría, no sólo la hoja: un moderador necesita
                «Motor › Coches › Berlinas» para juzgar si está bien clasificado. */}
            <p className="mt-1 text-xs text-muted-foreground" data-testid="ficha-categoria">
              {data.categoryPath.length > 0
                ? data.categoryPath.map((c) => c.name).join(' › ')
                : data.category.name}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {/* El anuncio público sólo existe si está ACTIVE — el mismo 404 que
                hacía inútil el enlace de la cola. Así que el enlace a la pública
                se ofrece SÓLO cuando lleva a alguna parte. */}
            {data.status === 'ACTIVE' && (
              <a
                href={`/anuncio/${data.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
              >
                Ver anuncio público <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {puedeEliminar && data.status === 'ARCHIVED' && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmarBorrado(true)}
                data-testid="ficha-eliminar"
              >
                Eliminar
              </Button>
            )}
          </div>
        </div>

        {/* Las acciones de estado. Un solo control, porque la decisión de qué
            endpoint usar la toma `elegirAccionDeEstado`, no el moderador. */}
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4">
          <div>
            <label
              htmlFor="ficha-nuevo-estado"
              className="mb-1 block text-xs text-muted-foreground"
            >
              Cambiar estado
            </label>
            <select
              id="ficha-nuevo-estado"
              value={nuevoEstado}
              onChange={(e) => setNuevoEstado(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              data-testid="ficha-selector-estado"
            >
              {TARGET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {etiquetaDeEstado(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[12rem] flex-1">
            <label htmlFor="ficha-motivo" className="mb-1 block text-xs text-muted-foreground">
              Motivo (se envía al vendedor al rechazar)
            </label>
            <input
              id="ficha-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              data-testid="ficha-motivo"
            />
          </div>
          <Button
            size="sm"
            onClick={() => void cambiarEstado()}
            disabled={guardando || nuevoEstado === data.status}
            data-testid="ficha-aplicar-estado"
          >
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Aplicar'}
          </Button>
        </div>

        {/* ETIQUETA INTERNA (P1, E2) — LOS CONTROLES MANUALES.
            Fila propia, separada de los de estado por un borde: cambiar el
            estado del anuncio y anotar el triaje son acciones de ejes distintos
            y no deben leerse como variantes de la misma.
            `EDITED` NO ES UNA OPCIÓN: afirma un hecho que sólo el sistema puede
            saber, y el backend lo rechaza con 400 — la UI no ofrece un botón
            que va a fallar. */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-xs text-muted-foreground">Marcar como:</span>
          {TRIAGE_MANUAL_VALUES.map((t) => (
            <Button
              key={t}
              size="sm"
              variant={data.triage === t ? 'default' : 'outline'}
              disabled={guardando || data.triage === t}
              onClick={() => void cambiarTriaje({ triage: t })}
              data-testid={`ficha-marcar-${t}`}
            >
              {TRIAGE_LABELS[t]}
            </Button>
          ))}
          <Button
            size="sm"
            variant={data.watched ? 'default' : 'outline'}
            disabled={guardando}
            onClick={() => void cambiarTriaje({ watched: !data.watched })}
            data-testid="ficha-alternar-watched"
          >
            {data.watched ? 'Quitar de observación' : 'Poner en observación'}
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* ── 2. El anuncio tal cual ──────────────────────────────────────
              ESTO es lo que el moderador no podía ver. */}
          <Seccion titulo="El anuncio">
            {data.images.length > 0 ? (
              <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {data.images.map((img) => (
                  <div
                    key={img.id}
                    className="relative aspect-square overflow-hidden rounded-md bg-muted"
                    data-testid="ficha-imagen"
                  >
                    <Image
                      src={img.url}
                      alt={img.alt ?? data.title}
                      fill
                      className="object-cover"
                      sizes="120px"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="mb-4 text-xs text-muted-foreground">Sin fotos.</p>
            )}

            {/* P3a — EL MODO EDICIÓN, POR SECCIÓN.
                F1 partió la ficha en secciones independientes exactamente para
                esto: quien viene a corregir un título no debe encontrarse un
                formulario de veinte campos. Se edita una sección, se guarda y el
                resto de la ficha ni se entera. */}
            {editando ? (
              <div className="space-y-2" data-testid="ficha-form-anuncio">
                <div>
                  <label htmlFor="ed-titulo" className="mb-1 block text-xs text-muted-foreground">
                    Título
                  </label>
                  <input
                    id="ed-titulo"
                    value={edTitulo}
                    onChange={(e) => setEdTitulo(e.target.value)}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    data-testid="ficha-edit-titulo"
                  />
                </div>
                <div>
                  <label htmlFor="ed-desc" className="mb-1 block text-xs text-muted-foreground">
                    Descripción
                  </label>
                  <textarea
                    id="ed-desc"
                    value={edDescripcion}
                    onChange={(e) => setEdDescripcion(e.target.value)}
                    rows={6}
                    className="w-full rounded-md border bg-background p-2 text-sm"
                    data-testid="ficha-edit-descripcion"
                  />
                </div>
                <div>
                  <label htmlFor="ed-precio" className="mb-1 block text-xs text-muted-foreground">
                    Precio
                  </label>
                  <input
                    id="ed-precio"
                    type="number"
                    min={0}
                    value={edPrecio}
                    onChange={(e) => setEdPrecio(e.target.value)}
                    className="h-9 w-40 rounded-md border bg-background px-2 text-sm"
                    data-testid="ficha-edit-precio"
                  />
                </div>
                <div>
                  <label htmlFor="ed-motivo" className="mb-1 block text-xs text-muted-foreground">
                    Motivo del cambio (queda en el historial)
                  </label>
                  <input
                    id="ed-motivo"
                    value={edMotivo}
                    onChange={(e) => setEdMotivo(e.target.value)}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    data-testid="ficha-edit-motivo"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={guardando || edMotivo.trim().length < 5}
                    onClick={() => void guardarEdicion()}
                    data-testid="ficha-edit-guardar"
                  >
                    {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={guardando}
                    onClick={() => setEditando(false)}
                    data-testid="ficha-edit-cancelar"
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-medium text-muted-foreground">Descripción</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => abrirEdicion()}
                    data-testid="ficha-edit-abrir"
                  >
                    Editar
                  </Button>
                </div>
                <p
                  className="whitespace-pre-wrap text-sm leading-relaxed"
                  data-testid="ficha-descripcion"
                >
                  {data.description}
                </p>
              </>
            )}

            {data.videoUrl && (
              <div className="mt-4">
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">Vídeo</h3>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  src={data.videoUrl}
                  poster={data.videoPosterUrl ?? undefined}
                  controls
                  className="max-h-64 rounded-md"
                  data-testid="ficha-video"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.videoDurationSeconds ?? '—'} s · subido{' '}
                  {formatDateTime(data.videoUploadedAt)}
                </p>
              </div>
            )}

            {data.category.attributeSchema?.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">Atributos</h3>
                <div className="divide-y">
                  {data.category.attributeSchema.map((attr) => {
                    const valor = data.attributes?.[attr.name];
                    return (
                      <Dato
                        key={attr.name}
                        etiqueta={attr.label}
                        valor={
                          valor === undefined || valor === null || valor === ''
                            ? '—'
                            : `${String(valor)}${attr.unit ? ` ${attr.unit}` : ''}`
                        }
                      />
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-4 divide-y">
              <Dato
                etiqueta="Ubicación"
                valor={
                  [data.city, data.province, data.postalCode].filter(Boolean).join(', ') || '—'
                }
              />
              <Dato etiqueta="Teléfono publicado" valor={data.phone ?? '—'} />
              <Dato etiqueta="Tipo" valor={data.type} />
              <Dato etiqueta="Estado del artículo" valor={data.condition ?? '—'} />
              <Dato etiqueta="Formato de precio" valor={`${data.priceType} · ${data.priceUnit}`} />
            </div>
          </Seccion>

          {/* ── 4. Reportes ────────────────────────────────────────────────── */}
          <Seccion titulo="Reportes" contador={data._count.reports}>
            {data.reports.length === 0 ? (
              <Vacio>Sin reportes.</Vacio>
            ) : (
              <ul className="space-y-2" data-testid="ficha-reportes">
                {data.reports.map((r) => (
                  <li key={r.id} className="rounded-md border p-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{r.reason}</span>
                      <Badge variant="outline">{r.status}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.reporter?.name ?? 'Anónimo'} · {formatDateTime(r.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/admin/reportes"
              className="mt-2 inline-block text-xs text-muted-foreground hover:underline"
            >
              Ir a reportes →
            </Link>
          </Seccion>

          {/* ── 6b. Los registros que B1 hizo sobrevivir ───────────────────── */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Seccion titulo="Valoraciones" contador={data._count.reviews}>
              {data.reviews.length === 0 ? (
                <Vacio>Sin valoraciones.</Vacio>
              ) : (
                <ul className="space-y-2" data-testid="ficha-valoraciones">
                  {data.reviews.map((v) => (
                    <li key={v.id} className="text-sm">
                      <span className="font-medium">{'★'.repeat(v.rating)}</span>{' '}
                      <span className="text-muted-foreground">{v.author.name ?? '—'}</span>
                      {v.comment && <p className="text-xs text-muted-foreground">{v.comment}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Seccion>

            <Seccion titulo="Tickets" contador={data._count.tickets}>
              {data.tickets.length === 0 ? (
                <Vacio>Sin tickets.</Vacio>
              ) : (
                <ul className="space-y-1" data-testid="ficha-tickets">
                  {data.tickets.map((t) => (
                    <li key={t.id} className="text-sm">
                      <Link href={`/admin/tickets/${t.id}`} className="hover:underline">
                        {t.subject}
                      </Link>{' '}
                      <Badge variant="outline">{t.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Seccion>

            <Seccion titulo="Tratos" contador={data._count.deals}>
              {data.deals.length === 0 ? (
                <Vacio>Sin tratos cerrados.</Vacio>
              ) : (
                <ul className="space-y-1" data-testid="ficha-tratos">
                  {data.deals.map((d) => (
                    <li key={d.id} className="text-sm">
                      {d.buyer.name ?? '—'}{' '}
                      <span className="text-xs text-muted-foreground">
                        · {formatDateTime(d.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Seccion>

            <Seccion titulo="Actividad">
              <div className="divide-y">
                <Dato etiqueta="Vistas" valor={data.viewCount} />
                <Dato etiqueta="Días con vistas" valor={data._count.viewsDaily} />
                <Dato etiqueta="Favoritos" valor={data._count.favorites} />
                <Dato etiqueta="Conversaciones" valor={data._count.conversations} />
              </div>
            </Seccion>
          </div>

          {/* ── 8. Historial ───────────────────────────────────────────────── */}
          <Seccion titulo="Historial" contador={data.historial.length}>
            {data.historial.length === 0 ? (
              <Vacio>Sin movimientos registrados.</Vacio>
            ) : (
              <ul className="space-y-2" data-testid="ficha-historial">
                {data.historial.map((h) => {
                  const razon = (h.after as { reason?: string } | null)?.reason;
                  return (
                    <li key={h.id} className="border-l-2 pl-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {ACCION_LABELS[h.action] ?? h.action}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(h.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        por {h.actor?.name ?? '—'}
                        {razon ? ` · «${razon}»` : ''}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Seccion>
        </div>

        {/* ── Columna lateral ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* ── 3. Señales de moderación ───────────────────────────────────
              CUATRO caminos llevan a PENDING_REVIEW y NINGUNO se persiste al
              dispararse, así que la ficha enseña qué está encendido AHORA y lo
              dice con esas palabras. Fingir un motivo único sería inventárselo. */}
          <Seccion titulo="Señales de moderación">
            {data.status === 'PENDING_REVIEW' && !hayAlgunaSeñal && (
              <p className="mb-2 text-xs text-muted-foreground">
                Ninguna señal activa ahora mismo: la que lo mandó a la cola ya se ha apagado.
              </p>
            )}
            <div className="divide-y" data-testid="ficha-senales">
              <Dato
                etiqueta="Vendedor marcado"
                valor={señales.usuario ? <Badge variant="secondary">Sí</Badge> : 'No'}
              />
              <Dato
                etiqueta="Categoría marcada"
                valor={señales.categoria ? <Badge variant="secondary">Sí</Badge> : 'No'}
              />
              <Dato
                etiqueta="Revisión de plataforma"
                valor={señales.plataforma ? <Badge variant="secondary">Sí</Badge> : 'No'}
              />
              <Dato
                etiqueta="Palabra filtrada"
                valor={señales.palabraProhibida ? <Badge variant="secondary">Sí</Badge> : 'No'}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Lo que está encendido ahora — no necesariamente lo que envió el anuncio a la cola.
            </p>
          </Seccion>

          {/* ── 5. El vendedor ─────────────────────────────────────────────
              P2/U3 — YA REDIRIGIDO. Apuntaba a `/admin/usuarios?q={email}&destacado={id}`
              porque la ficha de usuario no existía y había que abrir su panel
              dentro de la lista. Ahora existe como ruta propia y el enlace va
              directo. Lo que F1 prometió se cumplió: no hubo que rediseñar nada
              de esta pantalla, sólo cambiar el destino. */}
          <Seccion titulo="Vendedor">
            <div className="divide-y">
              <Dato
                etiqueta="Nombre"
                valor={
                  <Link
                    href={`/admin/usuarios/${data.seller.id}`}
                    className="hover:underline"
                    data-testid="ficha-enlace-vendedor"
                  >
                    {data.seller.name ?? '—'}
                  </Link>
                }
              />
              <Dato etiqueta="Email" valor={data.seller.email} />
              <Dato etiqueta="Estado" valor={data.seller.status} />
              <Dato etiqueta="Rol" valor={data.seller.role} />
              <Dato etiqueta="Alta" valor={formatDateTime(data.seller.createdAt)} />
              <Dato etiqueta="De confianza" valor={data.seller.trusted ? 'Sí' : 'No'} />
              <Dato
                etiqueta="Requiere revisión"
                valor={data.seller.requiresReview ? 'Sí' : 'No'}
              />
            </div>
            {/* FICHA F2 — «enséñame todo lo suyo», que es el paso siguiente a
                encontrar un mal actor. El filtro por vendedor existía en el
                backend desde siempre y no había forma de invocarlo; ahora es un
                enlace, porque los filtros viven en la URL. */}
            <Link
              href={`/admin/anuncios?sellerId=${data.seller.id}`}
              className="mt-2 inline-block text-xs text-muted-foreground hover:underline"
              data-testid="ficha-ver-anuncios-vendedor"
            >
              Ver todos sus anuncios →
            </Link>
          </Seccion>

          {/* ── 7. Comercial ───────────────────────────────────────────────── */}
          <Seccion titulo="Fechas y promoción">
            <div className="divide-y">
              <Dato etiqueta="Creado" valor={formatDateTime(data.createdAt)} />
              <Dato etiqueta="Publicado" valor={formatDateTime(data.publishedAt)} />
              <Dato etiqueta="Caduca" valor={formatDateTime(data.expiresAt)} />
              <Dato etiqueta="Último cambio" valor={formatDateTime(data.updatedAt)} />
              <Dato etiqueta="Último bump" valor={formatDateTime(data.bumpedAt)} />
              <Dato
                etiqueta="Bump programado"
                valor={
                  data.bumpSchedule
                    ? `${data.bumpSchedule.status} · cada ${data.bumpSchedule.intervalDays} d`
                    : 'No'
                }
              />
            </div>
          </Seccion>
        </div>
      </div>

      <AlertDialog open={confirmarBorrado} onOpenChange={setConfirmarBorrado}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar «{data.title}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Es irreversible. Se borran sus fotos, vídeo, etiquetas, favoritos y estadísticas.
              SOBREVIVEN las denuncias, las conversaciones con sus mensajes, los tratos, las
              valoraciones y los tickets, cada uno guardando el título del anuncio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void eliminar()}
              data-testid="ficha-confirmar-eliminar"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
