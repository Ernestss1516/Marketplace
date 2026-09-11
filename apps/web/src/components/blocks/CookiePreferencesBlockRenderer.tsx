'use client';

import { Button } from '@/components/ui/button';
import { useConsent } from '@/components/consentimiento/consentimiento';

/**
 * COOKIES RÁFAGA 3 — EL PANEL DE PREFERENCIAS, DENTRO DE LA PÁGINA DE COOKIES.
 *
 * Ver docs/diseno-consentimiento-cookies.md §5.4.
 *
 * ─── POR QUÉ AQUÍ Y NO SÓLO EN EL FOOTER ────────────────────────────────────────
 *
 * El botón del footer (ráfaga 2) ya permite reabrir el banner desde cualquier página,
 * así que la vía existe. Pero quien está LEYENDO la política de cookies es exactamente
 * quien acaba de informarse y quiere decidir: mandarlo a buscar un enlace al pie es
 * pedirle un paso de más justo en el momento en que menos se le debe pedir.
 *
 * ─── ENSEÑA EL ESTADO ACTUAL, NO SÓLO LOS BOTONES ───────────────────────────────
 *
 * «Retirar el consentimiento» sin decir si lo hay es un botón a ciegas. Primero dice qué
 * está permitido ahora mismo, y después ofrece cambiarlo.
 *
 * ─── LO QUE MUESTRA NO LO CONFIGURA NADIE ───────────────────────────────────────
 *
 * Las categorías salen del código, no del editor: son las dos que corresponden a cookies
 * reales. Un editor que pudiera añadir «marketing» aquí estaría describiendo un
 * tratamiento que no existe, en el documento que existe precisamente para no mentir.
 */
export function CookiePreferencesBlockRenderer() {
  const { cargado, decidido, permite, conceder, rechazar } = useConsent();

  // Antes de leer la cookie no se sabe nada, y no saber es no consentir. Se pinta el
  // hueco con su altura para que no haya salto cuando llegue el estado real.
  const terceros = permite('terceros');

  return (
    <section
      data-testid="panel-preferencias-cookies"
      aria-label="Tus preferencias de cookies"
      className="rounded-lg border border-border bg-muted/30 p-5"
    >
      <h2 className="text-base font-semibold text-foreground">Tus preferencias</h2>

      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="font-medium text-foreground">Esenciales</dt>
          <dd className="text-muted-foreground">
            Siempre activas. Sin ellas no puedes iniciar sesión ni podríamos recordar esta
            misma elección, así que no se pueden desactivar.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">Contenido de terceros</dt>
          <dd className="text-muted-foreground">
            Vídeos y mapas incrustados (YouTube, Vimeo, MapTiler).{' '}
            <strong className="text-foreground" data-testid="panel-preferencias-estado">
              {!cargado
                ? 'Comprobando…'
                : terceros
                  ? 'Permitido ahora mismo.'
                  : 'No permitido ahora mismo.'}
            </strong>
          </dd>
        </div>
      </dl>

      {cargado && (
        <div className="mt-5 flex flex-wrap gap-2">
          {/* Los dos botones con la MISMA variante, igual que en el banner: aquí también
              cambiar de opinión en un sentido tiene que costar lo mismo que en el otro. */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="panel-preferencias-permitir"
            onClick={() => conceder('terceros')}
            disabled={terceros}
          >
            Permitir contenido de terceros
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="panel-preferencias-retirar"
            onClick={() => rechazar()}
            disabled={decidido && !terceros}
          >
            Retirar el consentimiento
          </Button>
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        {/* Lo que se prometió en el diseño (§2.5) y hay que cumplir: un iframe ya montado
            ya habló con el tercero, y desmontarlo no borra lo que aquel guardó. Se dice
            en vez de prometer un borrado que no podemos hacer. */}
        Al cambiar tus preferencias, el contenido de terceros deja de cargarse a partir de
        ese momento. Lo que ya se hubiera cargado en esta página seguirá ahí hasta que la
        recargues.
      </p>
    </section>
  );
}
