'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { StatsChart, STATS_COLORS } from '@/components/stats/StatsChart';
import { useActividad } from '@/components/stats/useActividad';
import {
  getPulsoPlataforma,
  RANGOS_ESTADISTICAS,
  type FilaPulso,
  type PulsoPlataforma,
} from '@/lib/api/admin-stats';

/**
 * ESTADÍSTICAS B.4 — EL PULSO DE LA PLATAFORMA.
 *
 * B1 dejó esta página como un índice porque su contenido real era esta ráfaga. Ahora
 * enseña lo que el encargo pedía: **qué actividad y qué números genera cada categoría**, y
 * cuál genera más.
 *
 * ─── UNA FILA POR CATEGORÍA RAÍZ, DESPLEGABLE ────────────────────────────────────
 *
 * Y no una fila por categoría a secas, porque serían decenas planas donde no se ve nada.
 * Las raíces enseñan lo que mueve su RAMA entera (`Listing.categoryId` apunta siempre a la
 * hoja, así que sin plegar una raíz diría casi cero) y el despliegue baja al detalle sin
 * pedir nada al servidor: el desglose viene en la misma respuesta.
 *
 * ─── LA COLUMNA CON MÁS SEÑAL ES EL CTR ──────────────────────────────────────────
 *
 * Una categoría con muchas veces-listado y pocas visitas es una categoría cuyos resultados
 * NO CONVENCEN —fotos, precios o títulos malos, o un esquema de atributos que no deja
 * filtrar lo que la gente busca—. Es la única columna de esta tabla que sugiere qué hacer,
 * y por eso lleva el mismo tratamiento de muestra pequeña que el resto del producto: con
 * pocas apariciones no se pinta un porcentaje, se pinta un guion.
 *
 * ─── Y LA DELTA CONVIERTE LA TABLA EN UN AVISO ──────────────────────────────────
 *
 * Un número absoluto no dice si algo va mal. «−40 % en visitas» sí.
 */

const NUM = new Intl.NumberFormat('es-ES');
const PCT = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 1 });
const DELTA = new Intl.NumberFormat('es-ES', {
  style: 'percent',
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero',
});

type Columna = 'name' | 'activeListings' | 'views' | 'impressions' | 'ctr';

const COLUMNAS: Array<{ key: Columna; label: string; numerica: boolean }> = [
  { key: 'name', label: 'Categoría', numerica: false },
  { key: 'activeListings', label: 'Anuncios activos', numerica: true },
  { key: 'views', label: 'Visitas', numerica: true },
  { key: 'impressions', label: 'Veces listado', numerica: true },
  { key: 'ctr', label: 'CTR', numerica: true },
];

/** El CTR, o un guion cuando la muestra no da para publicarlo. */
function Ctr({ fila }: { fila: FilaPulso }) {
  if (fila.ctr === null) {
    return (
      <span
        className="text-muted-foreground"
        title={`Hacen falta al menos ${fila.ctrMinImpressions} apariciones; lleva ${fila.impressions}.`}
      >
        —
      </span>
    );
  }
  return <>{PCT.format(fila.ctr)}</>;
}

function Delta({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-muted-foreground">—</span>;
  const color = valor > 0 ? 'text-emerald-600' : valor < 0 ? 'text-destructive' : '';
  return <span className={color}>{DELTA.format(valor)}</span>;
}

function Fila({
  fila,
  esHija,
  expandida,
  onToggle,
  tieneHijas,
}: {
  fila: FilaPulso;
  esHija?: boolean;
  expandida?: boolean;
  onToggle?: () => void;
  tieneHijas?: boolean;
}) {
  return (
    <tr className={esHija ? 'bg-muted/20 text-sm' : 'text-sm'} data-testid={`pulso-fila-${fila.slug}`}>
      <td className="py-2 pr-2">
        <div className={`flex items-center gap-1 ${esHija ? 'pl-6' : ''}`}>
          {tieneHijas ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expandida}
              aria-label={`${expandida ? 'Plegar' : 'Desplegar'} ${fila.name}`}
              className="rounded p-0.5 hover:bg-muted"
            >
              {expandida ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span className="w-[1.125rem]" aria-hidden />
          )}
          <Link
            href={`/admin/estadisticas/categorias/${fila.id}`}
            className="hover:underline"
            data-testid={`pulso-enlace-${fila.slug}`}
          >
            {fila.name}
          </Link>
        </div>
      </td>
      <td className="py-2 text-right tabular-nums">{NUM.format(fila.activeListings)}</td>
      <td className="py-2 text-right tabular-nums">
        {NUM.format(fila.views)}{' '}
        <span className="text-xs">
          <Delta valor={fila.viewsDelta} />
        </span>
      </td>
      <td className="py-2 text-right tabular-nums">
        {NUM.format(fila.impressions)}{' '}
        <span className="text-xs">
          <Delta valor={fila.impressionsDelta} />
        </span>
      </td>
      <td className="py-2 text-right tabular-nums">
        <Ctr fila={fila} />
      </td>
    </tr>
  );
}

export default function AdminEstadisticasPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const { actividad: pulso, days, setDays, loading, error } = useActividad<PulsoPlataforma>(
    (rango, tk) => getPulsoPlataforma(rango, tk),
    token,
  );

  const [orden, setOrden] = useState<Columna>('views');
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());

  const categorias = useMemo(() => {
    if (!pulso) return [];
    // El backend ya devuelve ordenado por visitas; esto es la reordenación del staff.
    // `null` en el CTR va SIEMPRE al final: «no hay muestra» no es «cero».
    return [...pulso.categories].sort((a, b) => {
      if (orden === 'name') return a.name.localeCompare(b.name, 'es');
      if (orden === 'ctr') {
        if (a.ctr === null && b.ctr === null) return 0;
        if (a.ctr === null) return 1;
        if (b.ctr === null) return -1;
        return b.ctr - a.ctr;
      }
      return b[orden] - a[orden];
    });
  }, [pulso, orden]);

  const alternar = (id: string) =>
    setExpandidas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Estadísticas</h1>
          <p className="text-sm text-muted-foreground">
            La actividad real del sitio: cuántas veces se ven los anuncios y cuántas veces salen
            en los resultados de búsqueda.
          </p>
        </div>
        <div className="flex gap-1" role="group" aria-label="Ventana temporal">
          {RANGOS_ESTADISTICAS.map((rango) => (
            <button
              key={rango}
              type="button"
              onClick={() => setDays(rango)}
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
        <div
          className="mb-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
          data-testid="pulso-error"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          No se pudo cargar el pulso de la plataforma: {error}
        </div>
      )}

      {loading && !pulso && <div className="h-64 animate-pulse rounded-md bg-muted" aria-hidden />}

      {pulso && (
        <div className="space-y-6" data-testid="pulso-plataforma">
          {/* El pulso en una línea, antes del detalle. */}
          <div className="grid gap-4 sm:grid-cols-4">
            {[
              { etiqueta: 'Visitas', valor: NUM.format(pulso.totals.views) },
              { etiqueta: 'Veces listado', valor: NUM.format(pulso.totals.impressions) },
              {
                etiqueta: 'CTR del sitio',
                valor:
                  pulso.totals.ctr === null ? '—' : PCT.format(pulso.totals.ctr),
              },
              { etiqueta: 'Anuncios activos', valor: NUM.format(pulso.totals.activeListings) },
            ].map((kpi) => (
              <div key={kpi.etiqueta} className="rounded-lg border bg-card p-4">
                <p className="text-xs text-muted-foreground">{kpi.etiqueta}</p>
                <p className="text-2xl font-bold tabular-nums">{kpi.valor}</p>
              </div>
            ))}
          </div>

          <StatsChart
            testId="pulso-chart"
            title="Todo el sitio, por día"
            description={`Últimos ${pulso.days} días`}
            emptyMessage="Sin actividad registrada en esta ventana."
            series={[
              { key: 'views', label: 'Visitas', color: STATS_COLORS.views, data: pulso.dailyViews },
              {
                key: 'impressions',
                label: 'Veces listado',
                color: STATS_COLORS.impressions,
                data: pulso.dailyImpressions,
              },
            ]}
          />

          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Por categoría
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem]">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    {COLUMNAS.map((col) => (
                      <th
                        key={col.key}
                        scope="col"
                        className={`pb-2 font-medium ${col.numerica ? 'text-right' : 'text-left'}`}
                      >
                        <button
                          type="button"
                          onClick={() => setOrden(col.key)}
                          aria-pressed={orden === col.key}
                          className={`hover:underline ${orden === col.key ? 'text-foreground' : ''}`}
                        >
                          {col.label}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                {/* Cada raíz y, JUSTO DEBAJO, sus hijas si está desplegada. Un `map` de
                    raíces seguido de otro de hijas las habría amontonado todas al final
                    de la tabla, lejos de su padre. */}
                <tbody className="divide-y">
                  {categorias.flatMap((raiz) => [
                    <Fila
                      key={raiz.id}
                      fila={raiz}
                      tieneHijas={raiz.children.length > 0}
                      expandida={expandidas.has(raiz.id)}
                      onToggle={() => alternar(raiz.id)}
                    />,
                    ...(expandidas.has(raiz.id)
                      ? raiz.children.map((hija) => <Fila key={hija.id} fila={hija} esHija />)
                      : []),
                  ])}
                </tbody>
              </table>
            </div>
            {categorias.length === 0 && (
              <p className="text-sm text-muted-foreground">Todavía no hay categorías.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
