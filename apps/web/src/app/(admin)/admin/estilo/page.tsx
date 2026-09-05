'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AlertCircle, Loader2, RotateCcw, Save } from 'lucide-react';
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
import { ApiError } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import type { EstiloResuelto } from '@/lib/api/estilo';
import {
  fallosPorRanura,
  getEstiloAdmin,
  resetEstilo,
  setEstilo,
  textoDeFallo,
  type ColoresConfigurables,
  type EstadoEstilo,
  type ModeloDelCatalogo,
  type RanuraDeColor,
} from '@/lib/api/estilo-admin';
import { CampoDeColor } from './_components/CampoDeColor';
import { PreviaDelTema } from './_components/PreviaDelTema';
import { SesionNoDisponible } from '@/app/(admin)/components/SesionNoDisponible';

/**
 * EL ESTILO — `/admin/estilo`. Solo ADMIN.
 *
 * QUÉ RESUELVE. Desde E4a el sistema de estilo tenía registro, ajuste guardado, validación
 * de contraste y endpoint — todo menos por dónde entrar. Se podía configurar por API y por
 * ninguna otra vía. Ésta es esa vía: el modelo, su versión y los cuatro colores de los que
 * sale la paleta entera.
 *
 * ── SÍ HAY BOTÓN DE «GUARDAR», Y ES LA EXCEPCIÓN QUE EL DISEÑO YA PREVIÓ ─────────────
 *
 * Sus dos vecinas de Plataforma —marca e ilustraciones— no lo tienen: allí cada subida es
 * una operación completa en el servidor y un botón «sólo podría mentir sobre cuándo pasan
 * las cosas». Aquí es al revés y por un motivo concreto (§11): los cuatro colores **se
 * eligen juntos, se validan juntos contra AA y se guardan juntos**. Guardar en cada tecleo
 * dispararía una validación por pulsación y repintaría las 81 pantallas de la plataforma
 * con estados intermedios que nadie ha elegido.
 *
 * ── LO QUE PASA CUANDO EL CONTRASTE NO LLEGA ────────────────────────────────────────
 *
 * El 422 del servidor trae las parejas medidas con su ratio, y cada una se pinta **en el
 * campo del color que la mueve**, no en un toast. Ver `COLOR_CULPABLE` para la traducción
 * y `CampoDeColor` para el motivo. Lo que no se sepa ubicar se enseña arriba con su ratio:
 * un fallo puede quedarse sin campo, pero no puede perderse.
 *
 * ── SE REPUEBLA CON LA RESPUESTA ────────────────────────────────────────────────────
 *
 * Como la marca: el PUT y el DELETE devuelven el tema RESUELTO, así que la previa enseña
 * lo que la plataforma sirve de verdad y no lo que esta pantalla creyó mandar.
 *
 * Ver `docs/diseno-sistema-estilo.md` §11.
 */

const RANURAS: readonly {
  ranura: RanuraDeColor;
  etiqueta: string;
  descripcion: string;
}[] = [
  {
    ranura: 'primary',
    etiqueta: 'Principal',
    descripcion:
      'El color de la acción: botones, enlaces y el anillo de foco. Es el que más se ve.',
  },
  {
    ranura: 'secondary',
    etiqueta: 'Secundario',
    descripcion: 'El de las acciones que acompañan sin competir con la principal.',
  },
  {
    ranura: 'accent',
    etiqueta: 'Resalte',
    descripcion: 'El fondo de lo que está señalado: la fila bajo el cursor, la opción activa.',
  },
  {
    ranura: 'neutral',
    etiqueta: 'Neutro',
    descripcion:
      'El gris base. De él salen el fondo, las superficies, el trazo y el texto — es el que más cambia la plataforma aunque sea el que menos se nota.',
  },
];

export default function AdminEstiloPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
  const { run } = useApiAction();

  const [estado, setEstado] = useState<EstadoEstilo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  /** El borrador: lo que el admin lleva elegido y todavía no ha guardado. */
  const [modelo, setModelo] = useState<string>('');
  const [version, setVersion] = useState<string>('');
  const [colores, setColores] = useState<ColoresConfigurables | null>(null);

  /** Lo que el 422 devolvió la última vez. Se limpia al tocar cualquier cosa. */
  const [fallos, setFallos] = useState<ReturnType<typeof fallosPorRanura>>({
    porRanura: {},
    sinUbicar: [],
  });

  const aplicarConfig = useCallback((config: EstadoEstilo['config']) => {
    setModelo(config.modelo);
    setVersion(config.version);
    setColores({ ...config.colores });
  }, []);

  const cargar = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const nuevo = await getEstiloAdmin(token);
      setEstado(nuevo);
      aplicarConfig(nuevo.config);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error al cargar el estilo',
      );
    }
  }, [token, aplicarConfig]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const modeloElegido: ModeloDelCatalogo | undefined = useMemo(
    () => estado?.catalogo.find((m) => m.id === modelo),
    [estado, modelo],
  );

  /**
   * El borrador difiere de lo guardado. Gobierna dos cosas: si «Guardar» está vivo y si la
   * previa avisa de que enseña el tema anterior.
   */
  const hayCambios = useMemo(() => {
    if (!estado || !colores) return false;
    const c = estado.config;
    return (
      c.modelo !== modelo ||
      c.version !== version ||
      (Object.keys(colores) as RanuraDeColor[]).some((k) => c.colores[k] !== colores[k])
    );
  }, [estado, colores, modelo, version]);

  /** Cualquier edición invalida el veredicto anterior del servidor. */
  function limpiarFallos() {
    setFallos((previo) =>
      previo.sinUbicar.length === 0 && Object.keys(previo.porRanura).length === 0
        ? previo
        : { porRanura: {}, sinUbicar: [] },
    );
  }

  function cambiarModelo(id: string) {
    limpiarFallos();
    setModelo(id);
    const nuevo = estado?.catalogo.find((m) => m.id === id);
    if (!nuevo) return;
    // Cambiar de modelo trae SUS colores de fábrica y no conserva los del anterior: los
    // cuatro valores sólo significan algo dentro de la rampa del modelo que los deriva, y
    // arrastrarlos daría una combinación que nadie ha elegido. La versión, por lo mismo,
    // vuelve a la primera del modelo nuevo — la que tenía puede no existir aquí.
    setVersion(nuevo.versiones[0] ?? '');
    setColores({ ...nuevo.coloresPorDefecto });
  }

  function cambiarColor(ranura: RanuraDeColor, valor: string) {
    limpiarFallos();
    setColores((previo) => (previo ? { ...previo, [ranura]: valor } : previo));
  }

  function guardar() {
    if (!token || !colores) return;
    setOcupado(true);
    setError(null);
    void run(() => setEstilo({ modelo, version, colores }, token), {
      successMessage: 'Estilo guardado. La plataforma ya se ve con el tema nuevo.',
      onSuccess: (resuelto: EstiloResuelto) => {
        setFallos({ porRanura: {}, sinUbicar: [] });
        // El servidor guardó lo que se mandó: el borrador pasa a ser lo guardado y
        // `hayCambios` vuelve a false sin necesidad de otra petición.
        setEstado((previo) =>
          previo
            ? { ...previo, config: { modelo, version, colores: { ...colores } }, resuelto }
            : previo,
        );
      },
      onError: (err) => {
        // EL 422 DE CONTRASTE ES LO ÚNICO QUE NO ES UN ERROR GENÉRICO: trae las parejas
        // medidas y va a los campos. Cualquier otro fallo sí se queda arriba.
        if (err instanceof ApiError && err.fallos.length > 0) {
          setFallos(fallosPorRanura(err.fallos));
          return;
        }
        setError(
          err instanceof ApiError
            ? `Error ${err.statusCode}: ${err.message}`
            : 'No se ha podido guardar el estilo.',
        );
      },
    }).finally(() => setOcupado(false));
  }

  function volverAFabrica() {
    if (!token) return;
    setOcupado(true);
    setError(null);
    void run(() => resetEstilo(token), {
      successMessage: 'Estilo restaurado al modelo de fábrica.',
      onSuccess: () => {
        setFallos({ porRanura: {}, sinUbicar: [] });
        // Se recarga entero en vez de reconstruir la config de fábrica aquí: cuál es el
        // modelo por defecto y con qué colores lo decide el backend, y duplicar esa
        // respuesta en la pantalla sería una segunda verdad sobre el estado de fábrica.
        void cargar();
      },
      onError: (err) =>
        setError(
          err instanceof ApiError
            ? `Error ${err.statusCode}: ${err.message}`
            : 'No se ha podido restaurar el estilo.',
        ),
    }).finally(() => setOcupado(false));
  }

  if (!token) return <SesionNoDisponible />;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Estilo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          El modelo y los cuatro colores de los que sale la paleta de toda la plataforma.
          El color de la letra no se elige: lo decide el contraste, para que ninguna
          combinación deje texto ilegible. Las imágenes de los estados vacíos se cambian en{' '}
          <Link href="/admin/ilustraciones" className="text-primary hover:underline">
            Ilustraciones
          </Link>
          .
        </p>
      </div>

      {error && (
        <div
          className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          data-testid="estilo-error"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!estado && !error && <p className="text-sm text-muted-foreground">Cargando estilo…</p>}

      {estado && colores && (
        <>
          {/* ── Modelo y versión ─────────────────────────────────────────────── */}
          <section className="space-y-3 rounded-md border p-4" data-testid="bloque-modelo">
            <h2 className="text-sm font-semibold">Modelo</h2>

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label htmlFor="estilo-modelo" className="text-sm font-medium leading-none">
                  Modelo
                </label>
                <select
                  id="estilo-modelo"
                  value={modelo}
                  disabled={ocupado}
                  onChange={(e) => cambiarModelo(e.target.value)}
                  className="h-9 rounded-md border bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="selector-modelo"
                >
                  {estado.catalogo.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="estilo-version" className="text-sm font-medium leading-none">
                  Versión
                </label>
                <select
                  id="estilo-version"
                  value={version}
                  disabled={ocupado || !modeloElegido}
                  onChange={(e) => {
                    limpiarFallos();
                    setVersion(e.target.value);
                  }}
                  className="h-9 rounded-md border bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="selector-version"
                >
                  {(modeloElegido?.versiones ?? []).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {modeloElegido && (
              <p className="text-xs text-muted-foreground" data-testid="descripcion-modelo">
                {modeloElegido.descripcion}
              </p>
            )}
          </section>

          {/* ── Los cuatro colores ───────────────────────────────────────────── */}
          <section className="space-y-4 rounded-md border p-4" data-testid="bloque-colores">
            <div>
              <h2 className="text-sm font-semibold">Colores</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Cuatro, y ninguno más. Acepta un hexadecimal o un triplete HSL
                (<span className="font-mono">221.2 83.2% 53.3%</span>).
              </p>
            </div>

            {/*
              LOS FALLOS QUE NO SE SUPIERON UBICAR. No deberían aparecer nunca —hay un test
              espejo en `apps/api` que comprueba que cada pareja bloqueante tiene su campo—,
              pero si el backend añadiera una pareja nueva mañana, aquí se vería con su
              ratio en vez de desaparecer sin dejar rastro.
            */}
            {fallos.sinUbicar.length > 0 && (
              <div
                className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3"
                data-testid="fallos-sin-ubicar"
              >
                {fallos.sinUbicar.map((fallo) => (
                  <p key={fallo.pareja} className="text-xs text-destructive">
                    {textoDeFallo(fallo)}
                  </p>
                ))}
              </div>
            )}

            {RANURAS.map(({ ranura, etiqueta, descripcion }) => (
              <CampoDeColor
                key={ranura}
                ranura={ranura}
                etiqueta={etiqueta}
                descripcion={descripcion}
                valor={colores[ranura]}
                fallos={fallos.porRanura[ranura] ?? []}
                disabled={ocupado}
                onChange={(nuevo) => cambiarColor(ranura, nuevo)}
              />
            ))}
          </section>

          {/* ── La previa ────────────────────────────────────────────────────── */}
          <section className="rounded-md border p-4">
            <PreviaDelTema resuelto={estado.resuelto} hayCambiosSinGuardar={hayCambios} />
          </section>

          {/* ── Guardar / volver a fábrica ───────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={guardar}
              disabled={ocupado || !hayCambios}
              data-testid="guardar-estilo"
            >
              {ocupado ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Trabajando…
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" /> Guardar
                </>
              )}
            </Button>

            {/*
              ALERTDIALOG ANTES Y AVISO DESPUÉS, como manda la regla de la casa para lo
              irreversible: esto borra la configuración de la instancia —los cuatro colores
              que alguien eligió— y repinta las 81 pantallas. No se deshace con Ctrl+Z.
            */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={ocupado}
                  data-testid="volver-a-fabrica"
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> Volver a fábrica
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Volver al estilo de fábrica?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se descarta la configuración de esta instancia y la plataforma vuelve al
                    modelo por defecto con sus colores originales. Afecta a todas las
                    pantallas y no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={volverAFabrica}
                    data-testid="confirmar-volver-a-fabrica"
                  >
                    Volver a fábrica
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {hayCambios && (
              <span className="text-xs text-muted-foreground" data-testid="hay-cambios">
                Hay cambios sin guardar.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
