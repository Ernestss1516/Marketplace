'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AlertCircle, Check, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { mensajeDeErrorAdmin } from '@/lib/api/client';
import {
  getCookiesConfigLive,
  updateCookiesConfig,
  type CookieTextConfig,
} from '@/lib/api/cookies-admin';
import { SesionNoDisponible } from '@/app/(admin)/components/SesionNoDisponible';

/**
 * EL TEXTO DEL BANNER DE COOKIES — `/admin/cookies`. Solo ADMIN.
 *
 * Ver docs/diseno-consentimiento-cookies.md §4.
 *
 * ─── LA FRONTERA, QUE ES DE LO QUE VA ESTA PANTALLA ─────────────────────────────
 *
 * Aquí se edita **lo que el banner dice**. No se edita lo que el banner HACE.
 *
 * No hay —ni debe haber— un interruptor para apagar el banner, uno para elegir qué se
 * bloquea, uno para quitar el botón de rechazar ni uno para inventarse categorías. Eso es
 * la mecánica del consentimiento: es legal, es fija, y si fuera configurable el
 * cumplimiento pasaría a depender de que nadie tocara un ajuste.
 *
 * La frontera no se sostiene con este comentario: la sostiene el backend, cuyo
 * `UpdateCookieConfigDto` sólo conoce siete campos de texto. Esta pantalla no podría
 * apagar nada aunque alguien añadiera aquí un botón para intentarlo.
 *
 * ─── LA VERSIÓN VA APARTE, Y CON AVISO (D5) ─────────────────────────────────────
 *
 * Subirla vuelve a preguntarle a TODA la base de usuarios. Por eso no se deriva del texto
 * —una errata corregida no debe re-preguntar a nadie— y por eso vive en su propia
 * tarjeta, separada de los textos, con lo que hace escrito al lado.
 */

type Campo = keyof CookieTextConfig;

const ETIQUETAS: Record<Campo, string> = {
  title: 'Titular',
  body: 'Mensaje',
  acceptLabel: 'Botón de aceptar',
  rejectLabel: 'Botón de rechazar',
  moreLabel: 'Botón de más información',
  policyUrl: 'Enlace a la política de cookies',
  version: 'Versión del texto',
};

const AYUDAS: Partial<Record<Campo, string>> = {
  body: 'Lo que se lee bajo el titular. Di qué cookies usas y qué pasa si el visitante no acepta.',
  rejectLabel:
    'Tiene que expresar un rechazo inequívoco. El servidor rechaza «aceptar», «permitir», «vale» y equivalentes: el RGPD exige que rechazar sea tan fácil como aceptar, y eso empieza por el texto del botón.',
  policyUrl:
    'Ruta interna (/paginas/cookies) o dirección https://. Vacío mientras la página no exista: entonces «Más información» despliega el detalle en el propio banner en vez de enlazar a un 404.',
};

const CAMPOS_TEXTO: Campo[] = [
  'title',
  'body',
  'acceptLabel',
  'rejectLabel',
  'moreLabel',
  'policyUrl',
];

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50';

export default function AdminCookiesPage() {
  const { data: session, status } = useSession();
  const token = session?.user?.accessToken;

  const [config, setConfig] = useState<CookieTextConfig | null>(null);
  const [borrador, setBorrador] = useState<CookieTextConfig | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const cargar = useCallback(async () => {
    if (!token) return;
    setCargando(true);
    try {
      const actual = await getCookiesConfigLive(token);
      setConfig(actual);
      setBorrador(actual);
      setError(null);
    } catch (e) {
      setError(mensajeDeErrorAdmin(e, 'No se pudo cargar el texto del banner de cookies.'));
    } finally {
      setCargando(false);
    }
  }, [token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (status === 'loading' || (cargando && !config)) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }
  if (!token) return <SesionNoDisponible />;
  if (!config || !borrador) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" /> {error ?? 'No se pudo cargar la configuración.'}
      </div>
    );
  }

  // Sólo se manda lo que cambió — ver `updateCookiesConfig`.
  const cambios = (Object.keys(borrador) as Campo[]).reduce<Partial<CookieTextConfig>>(
    (acc, campo) => {
      if (borrador[campo] !== config[campo]) acc[campo] = borrador[campo];
      return acc;
    },
    {},
  );
  const hayCambios = Object.keys(cambios).length > 0;
  const versionCambiada = borrador.version !== config.version;

  const guardar = async () => {
    if (!hayCambios) return;
    setGuardando(true);
    setError(null);
    setGuardado(false);
    try {
      const actualizado = await updateCookiesConfig(cambios, token);
      setConfig(actualizado);
      setBorrador(actualizado);
      setGuardado(true);
    } catch (e) {
      setError(mensajeDeErrorAdmin(e, 'No se pudo guardar el texto del banner de cookies.'));
    } finally {
      setGuardando(false);
    }
  };

  const set = (campo: Campo, valor: string) =>
    setBorrador((b) => (b ? { ...b, [campo]: valor } : b));

  return (
    <div className="max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Cookies</h1>
        <p className="text-sm text-muted-foreground">
          El texto del banner de consentimiento de esta instancia. Se muestra en todas las
          páginas a quien todavía no ha decidido.
        </p>
      </header>

      {/* LA FRONTERA, DICHA AL ADMIN. No es decoración: quien entra aquí esperando poder
          apagar el banner tiene que encontrarse con el motivo, no con la ausencia. */}
      <section
        data-testid="cookies-frontera"
        className="flex gap-3 rounded-md border border-border bg-muted/40 p-4 text-sm"
      >
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1 text-muted-foreground">
          <p className="font-medium text-foreground">Aquí se edita el texto, no la mecánica.</p>
          <p>
            Qué se bloquea sin consentimiento, que el banner aparezca y que rechazar sea tan
            fácil como aceptar no son ajustes: son obligaciones legales y están fijadas en el
            código. Lo que cambia de una instancia a otra es cómo se cuenta.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Textos</h2>
        {CAMPOS_TEXTO.map((campo) => (
          <div key={campo} className="space-y-1">
            <label htmlFor={`campo-${campo}`} className="block text-sm font-medium">
              {ETIQUETAS[campo]}
            </label>
            {campo === 'body' ? (
              <textarea
                id={`campo-${campo}`}
                rows={4}
                className={inputCls}
                value={borrador[campo]}
                disabled={guardando}
                onChange={(e) => set(campo, e.target.value)}
              />
            ) : (
              <input
                id={`campo-${campo}`}
                type="text"
                className={inputCls}
                value={borrador[campo]}
                disabled={guardando}
                onChange={(e) => set(campo, e.target.value)}
              />
            )}
            {AYUDAS[campo] && <p className="text-xs text-muted-foreground">{AYUDAS[campo]}</p>}
          </div>
        ))}
      </section>

      <section className="space-y-3 rounded-md border border-warning-border bg-warning p-4">
        <h2 className="text-lg font-medium text-warning-foreground">Versión del texto</h2>
        <p className="text-sm text-warning-foreground">
          <strong>Subir la versión vuelve a preguntar a todos los usuarios</strong>, incluidos
          los que ya habían decidido. Hazlo sólo si el cambio afecta a lo que consintieron —
          no por corregir una errata.
        </p>
        <input
          id="campo-version"
          type="text"
          aria-label={ETIQUETAS.version}
          className={`${inputCls} max-w-[12rem]`}
          value={borrador.version}
          disabled={guardando}
          onChange={(e) => set('version', e.target.value)}
        />
        {versionCambiada && (
          <p
            data-testid="cookies-aviso-version"
            className="flex items-center gap-2 text-sm font-medium text-warning-foreground"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            Al guardar, el banner volverá a aparecerle a toda la base de usuarios.
          </p>
        )}
      </section>

      {error && (
        <p className="flex items-start gap-2 text-sm text-destructive" data-testid="cookies-error">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={guardar} disabled={!hayCambios || guardando}>
          {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar
        </Button>
        {guardado && !hayCambios && (
          <span
            className="flex items-center gap-1 text-sm text-muted-foreground"
            data-testid="cookies-guardado"
          >
            <Check className="h-4 w-4" /> Guardado
          </span>
        )}
      </div>
    </div>
  );
}
