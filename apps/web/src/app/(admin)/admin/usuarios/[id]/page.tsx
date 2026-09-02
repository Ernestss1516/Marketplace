'use client';

/**
 * FICHA DE USUARIO U3 (P2) — LA FICHA DE DETALLE DE UN USUARIO.
 *
 * Sustituye al panel desplegable de `/admin/usuarios` por una RUTA PROPIA, por
 * las mismas razones que la ficha de anuncio (F1): un panel dentro de una tabla
 * no se puede enlazar —y la ficha de anuncio necesita enlazar aquí— ni tiene
 * sitio para lo que hay que enseñar.
 *
 * PERMISOS, Y EL REPARTO QUE NO SE ENSANCHA. La ficha es **MODERATOR**, heredado
 * por segmento de la sección `usuarios` (sin fila nueva en el mapa). Pero el
 * BLOQUE DE DINERO es **ADMIN**, y el gate está en el backend, no aquí: sus datos
 * salen de `GET /admin/billing/users/:id`, que es ADMIN-only, mientras que el
 * detalle que alimenta el resto de esta pantalla —`GET /admin/users/:id`— no
 * incluye dinero. Para un MODERATOR ese componente ni se monta, así que la
 * petición no se hace; y si se hiciera, sería un 403.
 *
 * El motivo: `/admin/facturacion` ya era ADMIN y `/admin/usuarios` MODERATOR.
 * Juntar las dos vistas en una ficha no debía cambiar quién ve saldos y pagos.
 * Ver docs/diseno-ficha-usuario.md §4 y §7 (D-3).
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { getAdminUser, type AdminUserDetail } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { BloqueDinero } from './_components/BloqueDinero';
import { ValoracionFila } from '@/components/admin/ValoracionFila';
import { AccionesValoracion } from '@/components/admin/AccionesValoracion';
import { DatoIp } from '@/components/admin/DatoIp';
import { ActivityPanel } from '@/components/stats/ActivityPanel';
import { useActividad } from '@/components/stats/useActividad';
import { getActividadUsuario } from '@/lib/api/admin-stats';
import {
  adminListingHref,
  adminListingsBySellerHref,
  adminTicketHref,
} from '@/lib/admin-links';
import { ReporteFila } from '@/components/admin/ReporteFila';
import { ConversacionesPanel } from '@/components/admin/ConversacionesPanel';
import { getConversacionesDeUsuario } from '@/lib/api/admin-mensajeria';
// TRADUCCIONES — los cinco campos de esta ficha que pintaban el enum crudo. Sus
// propios `ESTADO_LABELS` y `ROL_LABELS` estaban aquí inline y han subido a
// `../../etiquetas` SIN cambiar de texto: lo que gana la ficha es alcanzar el resto
// del vocabulario (motivos y estados de denuncia, estado de ticket, acciones de la
// auditoría y los estados de anuncio, que ya tenían dueño en `listing-status.ts`).
import {
  ACCION_LABELS,
  ESTADO_USUARIO_LABELS,
  ROL_LABELS,
  etiqueta,
  etiquetaDeEstado,
  ticketStatusLabel,
} from '@/lib/etiquetas-enums';

const ESTADO_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive'> = {
  ACTIVE: 'default',
  SUSPENDED: 'secondary',
  BANNED: 'destructive',
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Seccion({
  titulo,
  contador,
  children,
  testId,
}: {
  titulo: string;
  contador?: number;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-4" data-testid={testId}>
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

export default function AdminFichaUsuarioPage() {
  const params = useParams<{ id: string }>();
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
  // El gate de D-3. No es cosmético: gobierna si el componente se MONTA, y por
  // tanto si su petición (ADMIN-only) llega a hacerse.
  const esAdmin = session?.user.role === 'ADMIN';

  const [data, setData] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ESTADÍSTICAS B1 — la actividad del CONJUNTO de sus anuncios. Petición propia, igual
  // que en la ficha de anuncio: el selector de ventana no debe recargar la ficha entera.
  // NO es ADMIN-only como el bloque de dinero: la telemetría es MODERATOR, el mismo piso
  // que la sección desde la que se llega.
  const {
    actividad,
    days,
    setDays,
    loading: cargandoActividad,
    error: errorActividad,
  } = useActividad((rango, tk) => getActividadUsuario(params.id, rango, tk), token);

  const cargar = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getAdminUser(token, params.id));
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

  // MENSAJERÍA C1 — memorizadas: el panel las tiene en sus deps, y sin `useCallback`
  // cada render crearía una función nueva y el efecto se repetiría en bucle.
  const cargarComoComprador = useCallback(
    (page: number) =>
      getConversacionesDeUsuario(token!, params.id, { papel: 'comprador', page }),
    [token, params.id],
  );
  const cargarComoVendedor = useCallback(
    (page: number) =>
      getConversacionesDeUsuario(token!, params.id, { papel: 'vendedor', page }),
    [token, params.id],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando ficha...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/usuarios"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a usuarios
        </Link>
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error ?? 'Sin datos'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-12" data-testid="ficha-usuario">
      <Link
        href="/admin/usuarios"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Volver a usuarios
      </Link>

      {/* ── Cabecera ─────────────────────────────────────────────────────── */}
      <header className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold" data-testid="usuario-nombre">
            {data.name ?? '—'}
          </h1>
          <Badge variant={ESTADO_VARIANTS[data.status] ?? 'secondary'} data-testid="usuario-estado">
            {etiqueta(ESTADO_USUARIO_LABELS, data.status)}
          </Badge>
          <Badge variant="outline">{etiqueta(ROL_LABELS, data.role)}</Badge>
          {/* El HECHO de ser Pro es información pública, así que también la ve un
              MODERATOR. La procedencia y el vencimiento están en el bloque de
              dinero, que es ADMIN. */}
          {data.isPro && <Badge data-testid="usuario-pro">Pro</Badge>}
          {data.trusted && <Badge variant="secondary">De confianza</Badge>}
          {data.requiresReview && <Badge variant="destructive">Requiere revisión</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="usuario-email">
          {data.email}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* ESTADÍSTICAS B1 — SECCIÓN NUEVA. Esta ficha tenía anuncios, valoraciones,
              reportes y tickets: todo contadores de inventario y de relación, ni una sola
              cifra de TRÁFICO. «Monitorear el conjunto de anuncios» de alguien empieza
              por poder verlo, y va lo primero porque es la pregunta con la que el staff
              abre esta pantalla.

              Los totales son de TODOS sus anuncios, en cualquier estado — no sólo los
              ACTIVE: un anuncio archivado que acumuló 40.000 visitas la semana pasada es
              exactamente lo que se está buscando. */}
          <Seccion titulo="Actividad" testId="usuario-actividad">
            <ActivityPanel
              testId="actividad-usuario"
              actividad={actividad}
              days={days}
              onDaysChange={setDays}
              loading={cargandoActividad}
              error={errorActividad}
            >
              {actividad && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span>
                    <strong>{actividad.viewCount.toLocaleString('es-ES')}</strong> visitas
                  </span>
                  <span>
                    <strong>{actividad.impressionCount.toLocaleString('es-ES')}</strong> veces
                    listado
                  </span>
                  <span className="text-muted-foreground">
                    en {actividad.listingCount}{' '}
                    {actividad.listingCount === 1 ? 'anuncio' : 'anuncios'}
                  </span>
                </div>
              )}
            </ActivityPanel>

            {/* Enlaces a la ficha del anuncio (B.1): lo que convierte esta pantalla en un
                punto de partida y no en un callejón. */}
            {actividad && (actividad.mostViewed || actividad.mostListed) && (
              <div className="mt-3 space-y-1 text-sm">
                {actividad.mostViewed && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Su anuncio más visto</span>
                    <Link
                      href={adminListingHref(actividad.mostViewed.id)}
                      className="line-clamp-1 text-right font-medium hover:underline"
                      data-testid="usuario-mas-visto"
                    >
                      {actividad.mostViewed.title} ({actividad.mostViewed.viewCount})
                    </Link>
                  </div>
                )}
                {actividad.mostListed && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Su anuncio más listado</span>
                    <Link
                      href={adminListingHref(actividad.mostListed.id)}
                      className="line-clamp-1 text-right font-medium hover:underline"
                      data-testid="usuario-mas-listado"
                    >
                      {actividad.mostListed.title} ({actividad.mostListed.impressionCount})
                    </Link>
                  </div>
                )}
              </div>
            )}
          </Seccion>

          <Seccion titulo="Anuncios" contador={data._count.listings} testId="usuario-anuncios">
            {data.listings.length === 0 ? (
              <Vacio>Sin anuncios.</Vacio>
            ) : (
              <ul className="space-y-1">
                {data.listings.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                    {/* EL CÍRCULO CON F1: desde el usuario a la ficha de su
                        anuncio, y desde allí de vuelta aquí. */}
                    <Link
                      href={adminListingHref(l.id)}
                      className="line-clamp-1 hover:underline"
                      data-testid={`usuario-anuncio-${l.id}`}
                    >
                      {l.title}
                    </Link>
                    {/* La MISMA etiqueta que la lista `/admin/anuncios` y que la
                        cabecera de la ficha de anuncio: sale de `listing-status.ts`,
                        que ya era su dueño único. Esta ficha simplemente no lo
                        importaba. */}
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {etiquetaDeEstado(l.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={adminListingsBySellerHref(data.id)}
              className="mt-2 inline-block text-xs text-muted-foreground hover:underline"
              data-testid="usuario-todos-anuncios"
            >
              Ver todos sus anuncios con filtros →
            </Link>
          </Seccion>

          <div className="grid gap-4 sm:grid-cols-2">
            <Seccion
              titulo="Valoraciones recibidas"
              contador={data._count.reviewsReceived}
              testId="usuario-valoraciones-recibidas"
            >
              {data.reviewsReceived.length === 0 ? (
                <Vacio>Sin valoraciones.</Vacio>
              ) : (
                <ul className="space-y-2">
                  {data.reviewsReceived.map((v) => (
                    <ValoracionFila
                      key={v.id}
                      rating={v.rating}
                      comment={v.comment}
                      createdAt={v.createdAt}
                      persona={v.author}
                      relacion="recibida"
                      verified={v.verified}
                      retiredAt={v.retiredAt}
                      retiredReason={v.retiredReason}
                      // 7b — las acciones sólo aquí y en «dadas», no en la ficha de
                      // anuncio: se modera la valoración desde la ficha de la PERSONA,
                      // que es donde el moderador está mirando su reputación.
                      acciones={
                        token && (
                          <AccionesValoracion
                            reviewId={v.id}
                            retirada={!!v.retiredAt}
                            rating={v.rating}
                            comment={v.comment}
                            token={token}
                            onHecho={cargar}
                          />
                        )
                      }
                    />
                  ))}
                </ul>
              )}
              {/* La API sirve las 10 más recientes. Decirlo evita que un contador de 40
                  con diez filas debajo se lea como que faltan treinta por cargar. */}
              {data._count.reviewsReceived > data.reviewsReceived.length && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Se muestran las {data.reviewsReceived.length} más recientes.
                </p>
              )}
            </Seccion>

            <Seccion titulo="Valoraciones dadas" testId="usuario-valoraciones-dadas">
              {data.reviewsAuthored.length === 0 ? (
                <Vacio>No ha valorado a nadie.</Vacio>
              ) : (
                <ul className="space-y-2">
                  {data.reviewsAuthored.map((v) => (
                    <ValoracionFila
                      key={v.id}
                      rating={v.rating}
                      comment={v.comment}
                      createdAt={v.createdAt}
                      persona={v.target}
                      relacion="dada"
                      verified={v.verified}
                      retiredAt={v.retiredAt}
                      retiredReason={v.retiredReason}
                      acciones={
                        token && (
                          <AccionesValoracion
                            reviewId={v.id}
                            retirada={!!v.retiredAt}
                            rating={v.rating}
                            comment={v.comment}
                            token={token}
                            onHecho={cargar}
                          />
                        )
                      }
                    />
                  ))}
                </ul>
              )}
              {/* SIN CONTADOR, y no por descuido: `_count` del backend trae
                  `reviewsReceived` pero no `reviewsAuthored`, así que aquí no hay número
                  fiable. Poner `length` diría «(10)» habiendo cuarenta. Añadirlo es tocar
                  la respuesta, y 7a es sólo pintar lo que ya llega. */}
            </Seccion>

            <Seccion titulo="Reportes recibidos" testId="usuario-reportes-recibidos">
              {data.reportsReceived.length === 0 ? (
                <Vacio>Sin reportes.</Vacio>
              ) : (
                <ul className="space-y-2">
                  {data.reportsReceived.map((r) => (
                    <ReporteFila key={r.id} reporte={r} formatearFecha={formatDateTime} />
                  ))}
                </ul>
              )}
            </Seccion>

            {/* El otro lado, que antes no se veía: un denunciante compulsivo
                sólo aparece mirando aquí. */}
            <Seccion
              titulo="Reportes hechos"
              contador={data._count.reportsMade}
              testId="usuario-reportes-hechos"
            >
              {data.reportsMade.length === 0 ? (
                <Vacio>No ha reportado nada.</Vacio>
              ) : (
                <ul className="space-y-2">
                  {data.reportsMade.map((r) => (
                    <ReporteFila key={r.id} reporte={r} formatearFecha={formatDateTime} />
                  ))}
                </ul>
              )}
            </Seccion>

            {/*
              MENSAJERÍA C1 — LAS DOS CARAS, SEPARADAS.
              Esta ficha no tenía NADA de mensajería: ni una sección, ni el número.

              Y van en dos listas porque son dos cosas distintas: lo que esta
              persona preguntó por cosas de otros, y lo que le preguntaron por lo
              suyo. Mezclarlas escondería justo el patrón que se investiga —
              «escribe a cincuenta vendedores y no compra nunca» no se ve en una
              lista revuelta—. Mismo reparto que las valoraciones «recibidas» y
              «dadas», que resolvieron antes esta misma forma.

              El contenido de los mensajes no se abre desde aquí (es C2).
            */}
            <Seccion titulo="Conversaciones como comprador" testId="usuario-conversaciones-comprador">
              <ConversacionesPanel
                token={token!}
                cargar={cargarComoComprador}
                vacio="No ha escrito a ningún vendedor."
              />
            </Seccion>

            <Seccion titulo="Conversaciones como vendedor" testId="usuario-conversaciones-vendedor">
              <ConversacionesPanel
                token={token!}
                cargar={cargarComoVendedor}
                vacio="Nadie le ha escrito por sus anuncios."
              />
            </Seccion>

            <Seccion titulo="Tickets" contador={data._count.tickets} testId="usuario-tickets">
              {data.tickets.length === 0 ? (
                <Vacio>Sin tickets.</Vacio>
              ) : (
                <ul className="space-y-1">
                  {data.tickets.map((t) => (
                    <li key={t.id} className="text-sm">
                      <Link href={adminTicketHref(t.id)} className="hover:underline">
                        {t.subject}
                      </Link>{' '}
                      <Badge variant="outline" className="text-[10px]">
                        {ticketStatusLabel(t.status)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              {/* PUNTO 1 — abrir un hilo CON ESTE USUARIO. Sin anuncio enlazado: desde
                  aquí el hilo va de la persona, no de una cosa suya. Si va de un
                  anuncio concreto, el botón está en la ficha de ese anuncio, que es
                  además donde el guard puede garantizar la pareja. */}
              <Link
                href={`/admin/tickets/nuevo?userId=${data.id}`}
                className="mt-3 inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors hover:bg-muted"
                data-testid="usuario-abrir-ticket"
              >
                Abrir ticket con este usuario
              </Link>
            </Seccion>
          </div>

          <Seccion
            titulo="Historial"
            contador={data.auditLogs.length}
            testId="usuario-historial"
          >
            {data.auditLogs.length === 0 ? (
              <Vacio>Sin movimientos registrados.</Vacio>
            ) : (
              <ul className="space-y-2">
                {data.auditLogs.map((h) => (
                  <li key={h.id} className="border-l-2 pl-3 text-sm">
                    {/* El MISMO vocabulario que el historial de la ficha de anuncio.
                        Vivía allí con sólo las `LISTING_*`; ahora incluye también las
                        `USER_*` y las de Pro, que son justo las que esta ficha lee. */}
                    <span className="font-medium">{etiqueta(ACCION_LABELS, h.action)}</span>{' '}
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(h.createdAt)}
                    </span>
                    <p className="text-xs text-muted-foreground">
                      por {h.actor?.name ?? '—'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
        </div>

        <div className="space-y-4">
          <Seccion titulo="Datos" testId="usuario-datos">
            <div className="divide-y">
              <Dato etiqueta="Email" valor={data.email} />
              <Dato etiqueta="Teléfono" valor={data.phone ?? '—'} />
              <Dato
                etiqueta="Ubicación"
                valor={[data.city, data.province, data.postalCode].filter(Boolean).join(', ') || '—'}
              />
              <Dato etiqueta="Email verificado" valor={data.emailVerified ? 'Sí' : 'No'} />
              <Dato etiqueta="Alta" valor={formatDateTime(data.createdAt)} />
              <Dato etiqueta="Último cambio" valor={formatDateTime(data.updatedAt)} />
              {/* ÚLTIMA IP (5b) — el dato que 5a captura. «Nunca» y no «—»: que una
                  cuenta no haya entrado JAMÁS es una respuesta, no una casilla vacía. */}
              <Dato
                etiqueta="Última conexión"
                valor={
                  data.lastLoginAt ? (
                    <span data-testid="usuario-ultima-conexion">
                      {formatDateTime(data.lastLoginAt)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground" data-testid="usuario-ultima-conexion">
                      Nunca
                    </span>
                  )
                }
              />
              <Dato
                etiqueta="IP del último inicio"
                valor={<DatoIp ip={data.lastLoginIp} marcada={data.ipFlagged} />}
              />
            </div>
          </Seccion>

          {/* ── EL GATE (D-3) ────────────────────────────────────────────────
              Para un MODERATOR este componente NO SE MONTA, así que su petición
              —que es ADMIN-only— no llega a hacerse. El dato del saldo no entra
              en su cliente por ninguna vía. */}
          {esAdmin && token && <BloqueDinero userId={data.id} token={token} />}
        </div>
      </div>
    </div>
  );
}
