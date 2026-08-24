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
import { getCategoryBySlug } from '@/lib/api/categorias';
import { attributeErrors, buildAttributes, filterSchemaByType } from '@/lib/attribute-schema';
import { StepAtributos } from '@/components/publicar/steps/StepAtributos';
import { ValoracionFila } from '@/components/admin/ValoracionFila';
import { DatoIp } from '@/components/admin/DatoIp';
import { VideoPlayer } from '@/components/anuncios/VideoPlayer';
import { ActivityPanel } from '@/components/stats/ActivityPanel';
import { useActividad } from '@/components/stats/useActividad';
import { getActividadAnuncio } from '@/lib/api/admin-stats';
import type { AttributeSchema, ListingType } from '@/types';
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
// TRADUCCIONES — los nueve campos de esta ficha que pintaban el enum crudo. El
// vocabulario vive en `../etiquetas` porque la ficha de usuario lee la mitad de él;
// `ACCION_LABELS` estaba aquí y ha subido allí por esa razón. Ver su cabecera.
import {
  ACCION_LABELS,
  CONDICION_LABELS,
  ESTADO_BUMP_LABELS,
  ESTADO_REPORTE_LABELS,
  DETECTION_FIELD_LABELS,
  DETECTOR_LABELS,
  ESTADO_USUARIO_LABELS,
  MOTIVO_REPORTE_LABELS,
  ROL_LABELS,
  TIPO_ANUNCIO_LABELS,
  TIPO_PRECIO_LABELS,
  UNIDAD_PRECIO_LABELS,
  etiqueta,
  ticketStatusLabel,
} from '../../etiquetas';

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

  // ESTADÍSTICAS B1 — la actividad va en SU PROPIA petición, no dentro del detalle.
  // Dos motivos: la ficha ya carga bastante y la serie diaria sólo se necesita al mirar
  // la sección de abajo; y el selector de ventana (7/30/90) recarga sólo esto, sin
  // volver a pedir el anuncio entero cada vez que el staff cambia de rango.
  const {
    actividad,
    days,
    setDays,
    loading: cargandoActividad,
    error: errorActividad,
  } = useActividad(
    (rango, tk) => getActividadAnuncio(params.id, rango, tk),
    token,
  );

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
  // 2a — los atributos, como cadenas (es lo que `StepAtributos` maneja, igual que
  // en el wizard del dueño; la conversión a su tipo la hace el backend al validar).
  const [edAtributos, setEdAtributos] = useState<Record<string, string>>({});

  /**
   * 2a — EL SCHEMA EFECTIVO DE LA CATEGORÍA, y no es un detalle de comodidad.
   *
   * `GET /admin/listings/:id` incluye `category: true`, o sea la FILA CRUDA: su
   * `attributeSchema` es **sólo el propio de la hoja**, sin los heredados. La validación
   * del backend, en cambio, corre contra el EFECTIVO —`applicableSchemaFor` sobre la
   * cadena entera de ancestros—, así que las dos no hablaban del mismo conjunto.
   *
   * Consecuencias, las dos verificadas:
   *
   *   · **de lectura**: la sección «Atributos» de esta ficha lleva desde F1 mostrando
   *     de menos. Un anuncio en «Motor › Coches › Berlinas» no enseñaba lo declarado en
   *     «Coches»;
   *   · **de escritura, y es la grave**: `attributes` se guarda por REEMPLAZO COMPLETO
   *     del jsonb (`admin.service.ts:754`), mientras que la validación se hace sobre el
   *     bag MEZCLADO (`existing` + delta). Un formulario construido con el schema de la
   *     hoja mandaría un bag incompleto: la validación lo daría por bueno —porque mezcla
   *     con lo que ya había— y la escritura BORRARÍA los heredados. En silencio.
   *
   * Se resuelve con el mismo par de llamadas que hace el editor del dueño
   * (`mis-anuncios/[id]/editar`): el anuncio, y después `GET /categories/:slug`, que sí
   * devuelve el efectivo ya plegado (`efectivoSchema`). Molde reusado, backend intacto.
   */
  const [schemaEfectivo, setSchemaEfectivo] = useState<AttributeSchema[]>([]);

  const cargar = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const d = await getAdminListing(token, params.id);
      setData(d);
      setNuevoEstado(d.status);
      // El efectivo, del endpoint público de categorías — ver `schemaEfectivo`. Va
      // DESPUÉS y con su propio `catch`: si falla, la ficha se pinta igual con lo que
      // trae el anuncio; lo único que se pierde es poder editar los atributos, y eso es
      // mejor que una pantalla en blanco por una llamada secundaria.
      try {
        const cat = await getCategoryBySlug(d.category.slug);
        setSchemaEfectivo(cat.attributeSchema ?? []);
      } catch {
        setSchemaEfectivo([]);
      }
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

  /**
   * Los atributos que el staff puede tocar: el efectivo de la cadena, filtrado por el
   * TIPO del anuncio. Mismo par de funciones que el wizard del dueño, y en el mismo
   * orden — `applicableSchemaFor` del backend es exactamente esto (pliegue + filtro),
   * así que el formulario ofrece ni más ni menos que lo que la validación va a exigir.
   *
   * `type` es inmutable en los dos caminos de edición, así que este conjunto no cambia
   * mientras la ficha está abierta.
   */
  const atributosEditables = data
    ? filterSchemaByType(schemaEfectivo, data.type as ListingType)
    : [];

  /**
   * Los errores de cliente de los atributos — la MISMA función que frena al dueño.
   *
   * NO es «validar dos veces por si acaso». Es lo que cierra un hueco real que el
   * backend tiene hoy: valida `attributes` sobre el bag MEZCLADO (lo guardado + lo que
   * llega) pero lo ESCRIBE por reemplazo completo, así que **vaciar un atributo
   * REQUERIDO se cuela** — el formulario no lo manda, la validación lo recupera de lo
   * guardado y lo da por bueno, y la escritura lo borra. El anuncio queda inválido en
   * silencio y el aviso de `needsRevalidation` le llega al VENDEDOR, que es exactamente
   * lo que P3a existe para evitar.
   *
   * El camino del dueño tiene el mismo hueco y sólo está a salvo porque su formulario
   * frena antes (`validateSection`). Que el backoffice frene en el MISMO sitio es lo
   * que hace cierta la promesa de P3a — «valida igual que el dueño» — mientras el hueco
   * del backend se cierra por su cuenta (anotado en `estado-tecnico.md`).
   */
  const erroresAtributos = editando ? attributeErrors(edAtributos, atributosEditables) : {};
  const hayErroresAtributos = Object.keys(erroresAtributos).length > 0;

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
    // 2a — el bag ENTERO, no sólo lo que tenga valor: el formulario tiene que poder
    // devolver todas las claves del schema efectivo (ver `guardarEdicion`).
    const actuales: Record<string, string> = {};
    for (const campo of atributosEditables) {
      const v = data.attributes?.[campo.name];
      actuales[campo.name] = v === undefined || v === null ? '' : String(v);
    }
    setEdAtributos(actuales);
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
        // 2a — SÓLO si hay schema que editar. Y siempre el bag COMPLETO: el backend
        // guarda `attributes` por reemplazo del jsonb entero, así que mandar un
        // subconjunto borraría el resto — y la validación no lo vería, porque valida
        // sobre la mezcla con lo ya guardado. Ver el comentario de `schemaEfectivo`.
        ...(atributosEditables.length > 0 && {
          attributes: buildAttributes(edAtributos, atributosEditables),
        }),
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

                {/* 2a — LOS ATRIBUTOS, con el mismo componente que el wizard del dueño.
                    No se reimplementa nada: los selects vinculados, el reseteo del hijo
                    al cambiar el padre y las unidades salen de `StepAtributos`.

                    Y la VALIDACIÓN no está aquí: la hace el backend, con la cadena de
                    ancestros entera (`applicableSchemaFor`) y el grandfathering fino
                    de P3a. Duplicarla en la pantalla sería la segunda copia que acaba
                    divergiendo — y la del backoffice es la que nadie prueba. */}
                {atributosEditables.length > 0 && (
                  <div className="border-t pt-3" data-testid="ficha-edit-atributos">
                    <StepAtributos
                      schema={atributosEditables}
                      values={edAtributos}
                      onChange={setEdAtributos}
                      // Sin errores de cliente: los que hay vienen del backend y se
                      // muestran donde ya se muestran los demás fallos de guardado.
                      errors={erroresAtributos}
                      showHeading={false}
                    />
                  </div>
                )}

                <div className="border-t pt-3">
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
                    disabled={guardando || edMotivo.trim().length < 5 || hayErroresAtributos}
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
                {/* FLECO #14 — el MISMO reproductor que la ficha pública, no un `<video>`
                    escrito a mano aquí. Los dos habían divergido en `preload` (éste no lo
                    llevaba, así que precargaba el vídeo en CADA apertura de la ficha, se
                    viniera a verlo o a cambiar el estado) y en la validación de origen
                    (éste pintaba la URL en crudo, y un `<video src>` no pasa por
                    `remotePatterns`). Con el componente compartido no hay dónde volver a
                    separarlas. */}
                <VideoPlayer
                  src={data.videoUrl}
                  poster={data.videoPosterUrl}
                  className="max-h-64 rounded-md"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.videoDurationSeconds ?? '—'} s · subido{' '}
                  {formatDateTime(data.videoUploadedAt)}
                </p>
              </div>
            )}

            {/* 2a — SE PINTA EL EFECTIVO, no el de la hoja. Antes salía
                `data.category.attributeSchema`, que es la fila cruda de la categoría: un
                anuncio en «Motor › Coches › Berlinas» no enseñaba lo declarado en
                «Coches». Es un arreglo de LECTURA que venía de F1, y entra aquí porque
                sería incoherente que el formulario ofreciera seis atributos y la vista
                de al lado enseñara tres. */}
            {atributosEditables.length > 0 && !editando && (
              <div className="mt-4" data-testid="ficha-atributos">
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">Atributos</h3>
                <div className="divide-y">
                  {atributosEditables.map((attr) => {
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
              <Dato etiqueta="Tipo" valor={etiqueta(TIPO_ANUNCIO_LABELS, data.type)} />
              <Dato
                etiqueta="Estado del artículo"
                valor={etiqueta(CONDICION_LABELS, data.condition)}
              />
              {/* Los dos ejes del precio siguen leyéndose juntos y en el mismo orden
                  —«¿hay importe y es firme?» · «¿por qué unidad?»—, sólo que ahora en
                  español. Ver el doc-comment de `PriceUnit` en schema.prisma. */}
              <Dato
                etiqueta="Formato de precio"
                valor={`${etiqueta(TIPO_PRECIO_LABELS, data.priceType)} · ${etiqueta(
                  UNIDAD_PRECIO_LABELS,
                  data.priceUnit,
                )}`}
              />
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
                      <span className="font-medium">
                        {etiqueta(MOTIVO_REPORTE_LABELS, r.reason)}
                      </span>
                      <Badge variant="outline">
                        {etiqueta(ESTADO_REPORTE_LABELS, r.status)}
                      </Badge>
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
                // 7a — la MISMA fila que la ficha de usuario. Esta pintaba estrellas,
                // nombre y comentario pero se callaba la fecha, y las cinco estrellas no
                // se veían. Tener dos maneras de enseñar lo mismo en el mismo backoffice
                // es como acaban divergiendo.
                <ul className="space-y-2" data-testid="ficha-valoraciones">
                  {data.reviews.map((v) => (
                    <ValoracionFila
                      key={v.id}
                      rating={v.rating}
                      comment={v.comment}
                      createdAt={v.createdAt}
                      persona={v.author}
                      relacion="recibida"
                      // 7b — MARCADAS pero SIN botones. Aquí las retiradas se ven (el
                      // staff no excluye) para que la ficha del anuncio no mienta sobre
                      // cuántas valoraciones tuvo; moderarlas se hace desde la ficha de
                      // la persona, que es donde está la reputación en juego.
                      verified={v.verified}
                      retiredAt={v.retiredAt}
                      retiredReason={v.retiredReason}
                    />
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
                      {/* La etiqueta sale del MISMO sitio que la insignia de color de
                          la bandeja `/admin/tickets` y de la zona de cuenta
                          (`TicketStatusBadge`). Aquí se usa sólo el texto: la insignia
                          de esta línea ya tiene su variante y su sitio. */}
                      <Badge variant="outline">{ticketStatusLabel(t.status)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              {/* PUNTO 1 — abrir un hilo SOBRE ESTE ANUNCIO. Sólo viaja el id del
                  anuncio: el destinatario (su vendedor) y el título los resuelve la
                  pantalla de destino contra el servidor. Ver su cabecera. */}
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                asChild
                data-testid="ficha-abrir-ticket"
              >
                <Link href={`/admin/tickets/nuevo?listingId=${data.id}`}>
                  Abrir ticket sobre este anuncio
                </Link>
              </Button>
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

            {/* ESTADÍSTICAS B1 — la sección «Actividad» tenía cuatro cifras sueltas y le
                faltaba la serie: «días con vistas» era el sustituto pobre de una gráfica.
                Ahora los cuatro datos se quedan (con «Veces listado» de compañero) y
                debajo va la cronología, con el MISMO componente que ve el vendedor Pro. */}
            <Seccion titulo="Actividad">
              <div className="divide-y">
                <Dato etiqueta="Vistas" valor={data.viewCount} />
                <Dato etiqueta="Veces listado" valor={actividad?.impressionCount ?? '—'} />
                <Dato etiqueta="Días con vistas" valor={data._count.viewsDaily} />
                <Dato etiqueta="Favoritos" valor={data._count.favorites} />
                <Dato etiqueta="Conversaciones" valor={data._count.conversations} />
              </div>
              <div className="mt-4">
                <ActivityPanel
                  testId="actividad-anuncio"
                  actividad={actividad}
                  days={days}
                  onDaysChange={setDays}
                  loading={cargandoActividad}
                  error={errorActividad}
                />
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
                          {etiqueta(ACCION_LABELS, h.action)}
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

          {/* ── 3b. Lo que el motor encontró en el texto (punto 6, ráfaga A) ──
              SECCIÓN PROPIA Y NO UNA FILA MÁS EN «Señales», y la razón no es de
              maquetación: su GARANTÍA es distinta. Las señales son lo que está
              encendido AHORA y ninguna se persiste al dispararse; estas
              detecciones SÍ son el resultado de la última pasada real sobre este
              texto, porque se reemplazan enteras cada vez que alguien lo escribe.
              Mezclarlas haría que la ficha prometiera de las señales algo que no
              puede cumplir. */}
          <Seccion titulo="Detectado en el texto">
            {data.detections.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                El motor no ha encontrado nada en el título ni en la descripción.
              </p>
            ) : (
              <ul className="space-y-2" data-testid="ficha-detecciones">
                {data.detections.map((d) => (
                  <li key={d.id} className="border-l-2 border-amber-400 pl-3 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">
                        {etiqueta(DETECTOR_LABELS, d.detector)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        en el {etiqueta(DETECTION_FIELD_LABELS, d.field)}
                      </span>
                    </div>
                    {/* EL FRAGMENTO, no un «Sí». Una IP en un anuncio de router es
                        legítima y en uno de bicicletas no, y esa diferencia sólo se
                        ve leyendo QUÉ se encontró. Es la regla de F1: enseñar el
                        dato, no fingir. */}
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      {d.match}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Encontrar algo <strong>no</strong> despublica el anuncio: hoy estos avisos sólo
              marcan, para poder medir cuánto se equivocan.
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
              <Dato etiqueta="Estado" valor={etiqueta(ESTADO_USUARIO_LABELS, data.seller.status)} />
              <Dato etiqueta="Rol" valor={etiqueta(ROL_LABELS, data.seller.role)} />
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
              {/* ÚLTIMA IP (5b) — la última vez que EL DUEÑO gestionó el anuncio, que es
                  otra pregunta que «Último cambio»: ése lo mueve también el staff. */}
              <Dato
                etiqueta="Última gestión del dueño"
                valor={formatDateTime(data.lastOwnerInteractionAt)}
              />
              <Dato
                etiqueta="IP del dueño"
                valor={<DatoIp ip={data.lastOwnerIp} marcada={data.ipFlagged} />}
              />
              <Dato
                etiqueta="Bump programado"
                valor={
                  data.bumpSchedule
                    ? `${etiqueta(ESTADO_BUMP_LABELS, data.bumpSchedule.status)} · cada ${
                        data.bumpSchedule.intervalDays
                      } d`
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
