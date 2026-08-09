'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarClock, ChevronDown, Loader2, PauseCircle, PlayCircle, Trash2 } from 'lucide-react';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useApiAction } from '@/lib/api/use-api-action';
import {
  cadenciaLabel,
  deleteBumpSchedule,
  estadoProgramacion,
  fechaHoraPeninsular,
  getBumpRuns,
  pauseBumpSchedule,
  resumeBumpSchedule,
  turnoLabel,
  type BumpRunItem,
  type BumpScheduleItem,
} from '@/lib/api/bump-schedules';

/**
 * «Bumps programados» — la vista de GESTIÓN del bump automático.
 *
 * Vive en /mis-creditos y no en una entrada propia del menú de cuenta por dos razones. La
 * primera es que aquí es donde el usuario viene cuando la pregunta es de DINERO —«¿por qué
 * se me van los créditos?»—, y esa es exactamente la pregunta que crea una subida
 * automática. La segunda es que UXV.2 costó reducir la zona a cuatro grupos y trece
 * entradas: añadir una decimocuarta para esto sería empezar a deshacerlo.
 *
 * Editar la cadencia NO se hace aquí, sino en el anuncio (el diálogo de «Promocionar»), que
 * es donde se creó y donde el usuario piensa en ella. Aquí se ve el conjunto y se decide
 * sobre él: pausar, reanudar, cancelar, y mirar qué pasó en cada turno.
 */
interface Props {
  token: string;
  inicial: BumpScheduleItem[];
}

export function BumpsProgramados({ token, inicial }: Props) {
  const router = useRouter();
  const { run } = useApiAction();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function accion(id: string, fn: () => Promise<unknown>, successMessage: string) {
    setBusyId(id);
    // UXV.3 — canal único: el resultado de una acción puntual se cuenta con un toast.
    await run(fn, { successMessage, onSuccess: () => router.refresh() });
    setBusyId(null);
  }

  if (inicial.length === 0) {
    return (
      // UXV.6 (B5) — el vacío dice QUÉ es esto y por dónde se empieza, en vez de constatar
      // que no hay nada.
      <p className="text-sm text-muted-foreground">
        No tienes bumps programados. Puedes hacer que un anuncio suba solo cada cierto tiempo
        desde{' '}
        <Link href="/mis-anuncios" className="underline hover:text-foreground">
          Mis anuncios
        </Link>
        , en «Promocionar».
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-lg border" data-testid="bumps-programados">
      {inicial.map((s) => {
        const estado = estadoProgramacion(s);
        const busy = busyId === s.id;

        return (
          <li key={s.id} className="space-y-3 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/anuncio/${s.listing.slug}`}
                  className="font-medium hover:underline"
                  prefetch={false}
                >
                  {s.listing.title}
                </Link>
                <p className="mt-0.5 text-muted-foreground">
                  {cadenciaLabel(s.intervalDays, s.hourOfDay)}
                </p>
                <p
                  className={`mt-0.5 flex flex-wrap items-center gap-1 ${
                    estado.activa ? 'text-muted-foreground' : 'font-medium text-amber-600'
                  }`}
                  data-testid="estado-programacion"
                >
                  {estado.activa ? (
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  ) : (
                    <PauseCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  )}
                  {estado.texto}
                  {/* La razón de la pausa trae su salida. Un «pausado» sin más deja al
                      usuario sin saber qué hacer para que vuelva a funcionar. */}
                  {estado.accion && (
                    <Link href={estado.accion.href} className="underline hover:text-foreground">
                      {estado.accion.label}
                    </Link>
                  )}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {estado.activa ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      accion(s.id, () => pauseBumpSchedule(token, s.id), 'Bumps programados en pausa.')
                    }
                  >
                    {busy ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <PauseCircle className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Pausar
                  </Button>
                ) : (
                  /* D2 — reanudar es un ACTO. Recargar créditos no reactiva sola una
                     programación: la bolsa es común y el usuario puede haber recargado
                     para otra cosa. */
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      accion(
                        s.id,
                        () => resumeBumpSchedule(token, s.id),
                        'Bumps programados reanudados.',
                      )
                    }
                  >
                    {busy ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Reanudar
                  </Button>
                )}

                {/* Cancelar borra la programación y su historial: se confirma, como
                    archivar un anuncio o emitir una factura. */}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy}>
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Cancelar
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Cancelar los bumps programados?</AlertDialogTitle>
                      <AlertDialogDescription>
                        «{s.listing.title}» dejará de subirse solo. No se te cobrará nada más
                        por esta programación, y su historial de subidas se borrará con ella.
                        Puedes volver a programarla cuando quieras.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Volver</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          accion(
                            s.id,
                            () => deleteBumpSchedule(token, s.id),
                            'Programación cancelada.',
                          )
                        }
                      >
                        Cancelar programación
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>

            <HistorialTurnos token={token} scheduleId={s.id} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * El historial de turnos, plegado.
 *
 * D6 decidió no notificar cada bump aplicado para no inundar la campana; la contrapartida es
 * que la trazabilidad tiene que estar en algún sitio, completa y a mano. Este es ese sitio, y
 * por eso incluye también los turnos que NO cobraron: un historial que solo enseñe los cobros
 * no explica los huecos, y el hueco es justo lo que hace dudar.
 *
 * Se carga bajo demanda: la mayoría de las veces el usuario solo quiere ver que está activo.
 */
function HistorialTurnos({ token, scheduleId }: { token: string; scheduleId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [turnos, setTurnos] = useState<BumpRunItem[] | null>(null);
  const [cargando, setCargando] = useState(false);

  async function alternar() {
    const siguiente = !abierto;
    setAbierto(siguiente);
    if (siguiente && turnos === null) {
      setCargando(true);
      const res = await getBumpRuns(token, scheduleId).catch(() => null);
      setTurnos(res?.items ?? []);
      setCargando(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={alternar}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        aria-expanded={abierto}
        data-testid="ver-turnos"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${abierto ? 'rotate-180' : ''}`} />
        {abierto ? 'Ocultar subidas' : 'Ver subidas'}
      </button>

      {abierto && (
        <div className="mt-2" data-testid="turnos">
          {cargando ? (
            <p className="text-xs text-muted-foreground">Cargando…</p>
          ) : turnos && turnos.length > 0 ? (
            <ul className="space-y-1">
              {turnos.map((t) => (
                <li key={t.id} className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">{fechaHoraPeninsular(t.slot)}</span>
                  <span>·</span>
                  <span>{turnoLabel(t)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              Todavía no se ha aplicado ninguna subida programada.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
