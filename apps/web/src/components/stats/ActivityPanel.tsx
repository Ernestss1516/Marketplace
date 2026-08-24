'use client';

import { StatsChart, STATS_COLORS } from './StatsChart';
import { CtrLine } from './CtrLine';
import { LikeRatioLine } from './LikeRatioLine';
import { RANGOS_ESTADISTICAS, type ActividadBase, type RangoEstadisticas } from '@/lib/api/admin-stats';

/**
 * ESTADÍSTICAS B1 — el panel de actividad del backoffice.
 *
 * ─── NO DIBUJA NADA: COMPONE ─────────────────────────────────────────────────────
 *
 * La gráfica es `StatsChart` y los ratios son `CtrLine` / `LikeRatioLine`, **los mismos
 * componentes que ve el vendedor Pro** en `/mis-anuncios/estadisticas`. Ésa es la razón de
 * que A2 los extrajera en su día: el staff mira exactamente la misma telemetría, con los
 * mismos colores, el mismo relleno de huecos con 0 y el mismo tratamiento de muestra
 * pequeña. Si aquí hubiera una segunda gráfica, las dos empezarían a divergir el día que
 * alguien cambiara un formato de fecha en una de ellas.
 *
 * Lo único que este panel añade es lo que el backoffice necesita y el vendedor no: el
 * SELECTOR DE VENTANA (7/30/90). El Pro ve 30 fijos porque su pregunta es «¿cómo va mi
 * anuncio?»; la del staff es «¿esto lleva así mucho?», y eso necesita más rango.
 *
 * ─── Y NO HAY GATE PRO ───────────────────────────────────────────────────────────
 *
 * El vendedor paga por su gráfica; el staff no. Lo que decide quién entra aquí es el piso
 * de rol de la sección (`MODERATOR`), no un `isProActive`. Este componente no sabe nada de
 * planes, y no debe.
 */

interface Props {
  actividad: ActividadBase | null;
  days: RangoEstadisticas;
  onDaysChange: (days: RangoEstadisticas) => void;
  loading?: boolean;
  error?: string | null;
  /** Se antepone a la gráfica: los totales o el encabezado propios de cada vista. */
  children?: React.ReactNode;
  testId?: string;
}

export function ActivityPanel({
  actividad,
  days,
  onDaysChange,
  loading,
  error,
  children,
  testId,
}: Props) {
  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {children}
        <div className="flex gap-1" role="group" aria-label="Ventana temporal">
          {RANGOS_ESTADISTICAS.map((rango) => (
            <button
              key={rango}
              type="button"
              onClick={() => onDaysChange(rango)}
              aria-pressed={rango === days}
              className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                rango === days
                  ? 'border-foreground/20 bg-muted font-medium'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {rango} días
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive" data-testid="actividad-error">
          No se pudo cargar la actividad: {error}
        </p>
      )}

      {loading && !actividad && (
        <div className="h-64 w-full animate-pulse rounded-md bg-muted" aria-hidden />
      )}

      {actividad && (
        <>
          <StatsChart
            testId="actividad-chart"
            title="Visitas y veces listado, por día"
            description={`Últimos ${actividad.days} días`}
            emptyMessage="Sin actividad registrada en esta ventana."
            series={[
              {
                key: 'views',
                label: 'Visitas',
                color: STATS_COLORS.views,
                data: actividad.dailyViews,
              },
              {
                key: 'impressions',
                label: 'Veces listado',
                color: STATS_COLORS.impressions,
                data: actividad.dailyImpressions,
              },
            ]}
          />

          {/* LOS MISMOS RATIOS Y EL MISMO UMBRAL QUE VE EL VENDEDOR. El staff no necesita
              menos honestidad que el dueño: un «100%» sobre tres apariciones engaña igual
              a quien modera, y aquí encima se usa para decidir sobre anuncios ajenos. */}
          <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <CtrLine ctr={actividad.ctr} />
            <LikeRatioLine likeRatio={actividad.likeRatio} />
          </div>
        </>
      )}
    </div>
  );
}
