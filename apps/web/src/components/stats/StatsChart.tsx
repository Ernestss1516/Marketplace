'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

/**
 * ESTADÍSTICAS A2 — LA GRÁFICA CRONOLÓGICA, EXTRAÍDA.
 *
 * Vivía incrustada dentro de `EstadisticasClient` y pintaba UNA serie (vistas por día).
 * Sale de ahí ahora, y no por higiene: B1 (el backoffice) va a pintar exactamente estas
 * mismas series —visitas y veces listado— para CUALQUIER anuncio, para el conjunto de un
 * usuario y para el de una categoría. Con la gráfica dentro del componente del vendedor,
 * el backoffice habría tenido que duplicarla, y a partir de ahí las dos copias
 * divergirían: un formato de fecha aquí, un estado vacío distinto allá.
 *
 * ES UNA EXTRACCIÓN, NO UNA REESCRITURA: los ejes, la rejilla, el `Intl.DateTimeFormat`
 * español y el estado vacío se mueven tal cual desde `EstadisticasClient`. Lo único nuevo
 * es lo que exige la segunda serie: la leyenda y el color por serie.
 *
 * ─── POR QUÉ RECIBE LAS SERIES POR SEPARADO Y FUSIONA AQUÍ ───────────────────────
 *
 * Porque así es como llegan del backend: dos tablas gemelas, dos consultas, dos arrays
 * con SUS propios días. Un anuncio puede tener apariciones un martes en el que nadie
 * entró, y visitas un miércoles en el que no salió en ninguna búsqueda. Si cada llamante
 * tuviera que fusionarlas antes de llamar, esa fusión —con su relleno de ceros, que es
 * justo donde se cuela un hueco pintado como corte de línea— estaría repetida en el
 * vendedor y en las cuatro vistas del backoffice.
 */

export interface DailyPoint {
  date: string;
  count: number;
}

export interface StatsSeries {
  /** Clave interna; identifica la línea dentro del gráfico. */
  key: string;
  /** Texto de la leyenda y del tooltip — de cara al usuario, en español. */
  label: string;
  /** Color de la línea. Azul/naranja por defecto: legible también sin distinguir el rojo del verde. */
  color: string;
  data: DailyPoint[];
}

interface Props {
  title: string;
  description?: string;
  series: StatsSeries[];
  /** Qué decir cuando ninguna serie tiene un solo punto. */
  emptyMessage?: string;
  testId?: string;
}

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit' }).format(
    new Date(iso),
  );
}

/**
 * Fusiona N series diarias en las filas que recharts espera, UNA por fecha.
 *
 * **El relleno con 0 no es un detalle de implementación: es la corrección.** Cada serie
 * solo tiene fila los días en que pasó algo, así que sin rellenar, un día con visitas y
 * sin apariciones dejaría a la línea de apariciones sin punto — y recharts dibujaría un
 * segmento recto por encima del hueco, que se lee como «ese día hubo apariciones
 * intermedias». Un cero es un hecho («ese día no apareciste»), no un dato que falta.
 *
 * Exportada aparte del componente para poder probar esa regla sin renderizar nada.
 */
export function mergeSeries(series: StatsSeries[]): Array<Record<string, string | number>> {
  const dates = [...new Set(series.flatMap((s) => s.data.map((p) => p.date)))].sort();

  return dates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const serie of series) {
      row[serie.key] = serie.data.find((p) => p.date === date)?.count ?? 0;
    }
    return row;
  });
}

export function StatsChart({ title, description, series, emptyMessage, testId }: Props) {
  const rows = mergeSeries(series);

  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {rows.length > 0 ? (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tickFormatter={formatDay} fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip labelFormatter={(label) => formatDay(String(label))} />
                {/* La leyenda es NUEVA respecto a la gráfica de una sola línea, y es
                    obligatoria en cuanto hay dos: sin ella, el vendedor ve dos colores y
                    tiene que adivinar cuál es cuál. */}
                {series.length > 1 && <Legend />}
                {series.map((serie) => (
                  <Line
                    key={serie.key}
                    type="monotone"
                    dataKey={serie.key}
                    name={serie.label}
                    stroke={serie.color}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {emptyMessage ?? 'Aún no hay datos suficientes.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Los dos colores del par visitas/apariciones, en un solo sitio para que no diverjan
 *  entre el panel del vendedor (A2) y el del backoffice (B1). */
export const STATS_COLORS = {
  views: '#2563eb',
  impressions: '#ea580c',
} as const;
