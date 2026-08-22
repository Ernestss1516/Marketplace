'use client';

/**
 * FICHA F2 (P6) — LOS CONTROLES CON LOS QUE EL MODERADOR ENCUENTRA UN ANUNCIO.
 *
 * NO HAY UN CONTROL POR COLUMNA. Cada eje de aquí existe porque desbloquea una
 * tarea real: «encuéntrame este anuncio» (texto), «qué hay pendiente» (estados,
 * en conjunto, porque las preguntas reales son conjuntos), «enséñame todo lo de
 * este vendedor», «qué se publica en esta rama» (con sus subcategorías), «qué
 * está denunciado», «qué dejó de cumplir su categoría», «qué entró esta semana».
 * Ver docs/diseno-ficha-anuncio.md §2.2.
 *
 * EL SITIO QUE F2 RESERVÓ, YA OCUPADO (P1/E2). La etiqueta interna entró
 * exactamente como se prometió: un campo en el DTO, una línea en el `where`, un
 * par de claves en `filtros-url.ts` y unos chips aquí. Ni este componente ni el
 * mapeo de la URL cambiaron de forma para admitirla — que es lo que quería decir
 * «ampliable sin rediseño», comprobado en vez de afirmado.
 *
 * Va en SU PROPIA FILA, separada de los chips de estado: son ejes distintos, y
 * mezclarlos en la misma tira invitaría a leerlos como una sola cosa.
 */

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { AdminCategory, AdminListingsFilters, AdminListingsOrder } from '@/lib/api/admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { STATUS_LABELS } from '../listing-status';
import { TRIAGE_LABELS, TRIAGE_VALUES, type Triage } from '../listing-triage';
import { ORDENES, hayFiltros } from '../filtros-url';
import { DETECTOR_LABELS } from '../../etiquetas';

/** Los nueve estados, en el orden en que un moderador los piensa. */
const ESTADOS = [
  'PENDING_REVIEW',
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'RESERVED',
  'SOLD',
  'EXPIRED',
  'REJECTED',
  'ARCHIVED',
];

/** Aplana el árbol a opciones con sangría, para poder elegir CUALQUIER nivel. */
function opcionesDeCategoria(
  categorias: AdminCategory[],
  nivel = 0,
): { id: string; etiqueta: string }[] {
  return categorias.flatMap((c) => [
    { id: c.id, etiqueta: `${'  '.repeat(nivel)}${nivel > 0 ? '└ ' : ''}${c.name}` },
    ...opcionesDeCategoria(c.children ?? [], nivel + 1),
  ]);
}

export function FiltrosAnuncios({
  filtros,
  categorias,
  total,
  onCambiar,
  onLimpiar,
}: {
  filtros: AdminListingsFilters;
  categorias: AdminCategory[];
  total: number;
  onCambiar: (cambio: Partial<AdminListingsFilters>) => void;
  onLimpiar: () => void;
}) {
  // El texto se escribe en local y se manda al confirmar (Intro o lupa): un
  // filtro por cada tecla dispararía una consulta por letra contra Postgres.
  const [texto, setTexto] = useState(filtros.q ?? '');
  useEffect(() => setTexto(filtros.q ?? ''), [filtros.q]);

  const estados = filtros.statuses ?? [];
  const triaje = filtros.triage ?? [];

  function alternarEstado(estado: string) {
    const siguiente = estados.includes(estado)
      ? estados.filter((e) => e !== estado)
      : [...estados, estado];
    onCambiar({ statuses: siguiente.length ? siguiente : undefined });
  }

  function alternarTriaje(valor: Triage) {
    const siguiente = triaje.includes(valor)
      ? triaje.filter((t) => t !== valor)
      : [...triaje, valor];
    onCambiar({ triage: siguiente.length ? siguiente : undefined });
  }

  /** Los conmutadores de tres posiciones: sin filtro → sí → no → sin filtro. */
  function alternarTerciario(valor: boolean | undefined): boolean | undefined {
    if (valor === undefined) return true;
    if (valor === true) return false;
    return undefined;
  }

  return (
    <div className="mb-4 space-y-3 rounded-lg border bg-card p-3" data-testid="filtros-anuncios">
      {/* Texto libre — el hueco que el backoffice no tenía: antes se paginaba
          hasta dar con el anuncio. */}
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCambiar({ q: texto || undefined });
            }}
            placeholder="Título, descripción, slug o id…"
            className="h-9 w-full rounded-md border bg-background pl-8 pr-2 text-sm"
            data-testid="filtro-texto"
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onCambiar({ q: texto || undefined })}
          data-testid="filtro-buscar"
        >
          Buscar
        </Button>

        <select
          value={filtros.order ?? 'recent'}
          onChange={(e) => onCambiar({ order: e.target.value as AdminListingsOrder })}
          className="h-9 rounded-md border bg-background px-2 text-sm"
          aria-label="Ordenar por"
          data-testid="filtro-orden"
        >
          {ORDENES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Estados: MÚLTIPLE. Ninguno marcado = todos, que es la vista de entrada
          y por eso no necesita un chip «Todos» que compita con los demás. */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-muted-foreground">Estado:</span>
        {ESTADOS.map((estado) => {
          const activo = estados.includes(estado);
          return (
            <button
              key={estado}
              type="button"
              onClick={() => alternarEstado(estado)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                activo
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-muted'
              }`}
              aria-pressed={activo}
              data-testid={`filtro-estado-${estado}`}
            >
              {STATUS_LABELS[estado] ?? estado}
            </button>
          );
        })}
      </div>

      {/* ETIQUETA INTERNA (P1, E2) — el triaje del staff, MÚLTIPLE y en su propia
          fila. Va separado de los chips de estado a propósito: son ejes
          distintos, y ponerlos en la misma tira invitaría a leerlos como una
          sola cosa. «Sin revisar» son `Nuevo` y `Editado` a la vez, que es la
          cola de trabajo real y por eso el filtro admite varios. */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-muted-foreground">Etiqueta interna:</span>
        {TRIAGE_VALUES.map((t) => {
          const activo = triaje.includes(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => alternarTriaje(t)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                activo
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-muted'
              }`}
              aria-pressed={activo}
              data-testid={`filtro-triage-${t}`}
            >
              {TRIAGE_LABELS[t]}
            </button>
          );
        })}
        <Button
          size="sm"
          variant={filtros.watched === undefined ? 'outline' : 'default'}
          className="ml-2 h-6 px-2 text-xs"
          onClick={() => onCambiar({ watched: alternarTerciario(filtros.watched) })}
          data-testid="filtro-watched"
        >
          {filtros.watched === undefined
            ? 'Observación: todas'
            : filtros.watched
              ? 'En observación'
              : 'Sin observar'}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {/* Categoría — el selector ofrece TODOS los niveles porque el filtro
            incluye la descendencia: elegir «Motor» trae también sus nietas. */}
        <div>
          <label htmlFor="filtro-categoria" className="mb-1 block text-xs text-muted-foreground">
            Categoría (incluye subcategorías)
          </label>
          <select
            id="filtro-categoria"
            value={filtros.categoryId ?? ''}
            onChange={(e) => onCambiar({ categoryId: e.target.value || undefined })}
            className="h-9 max-w-[16rem] rounded-md border bg-background px-2 text-sm"
            data-testid="filtro-categoria"
          >
            <option value="">Todas</option>
            {opcionesDeCategoria(categorias).map((o) => (
              <option key={o.id} value={o.id}>
                {o.etiqueta}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filtro-creado-desde" className="mb-1 block text-xs text-muted-foreground">
            Creado desde
          </label>
          <input
            id="filtro-creado-desde"
            type="date"
            value={filtros.createdFrom?.slice(0, 10) ?? ''}
            onChange={(e) =>
              onCambiar({
                createdFrom: e.target.value ? new Date(e.target.value).toISOString() : undefined,
              })
            }
            className="h-9 rounded-md border bg-background px-2 text-sm"
            data-testid="filtro-creado-desde"
          />
        </div>
        <div>
          <label htmlFor="filtro-creado-hasta" className="mb-1 block text-xs text-muted-foreground">
            hasta
          </label>
          <input
            id="filtro-creado-hasta"
            type="date"
            value={filtros.createdTo?.slice(0, 10) ?? ''}
            onChange={(e) =>
              onCambiar({
                createdTo: e.target.value ? new Date(e.target.value).toISOString() : undefined,
              })
            }
            className="h-9 rounded-md border bg-background px-2 text-sm"
            data-testid="filtro-creado-hasta"
          />
        </div>

        {/* Tres posiciones, no dos: «sin denuncias» es una pregunta útil y
            distinta de «me da igual». */}
        <Button
          size="sm"
          variant={filtros.hasReports === undefined ? 'outline' : 'default'}
          onClick={() => onCambiar({ hasReports: alternarTerciario(filtros.hasReports) })}
          data-testid="filtro-reportes"
        >
          {filtros.hasReports === undefined
            ? 'Denuncias: todas'
            : filtros.hasReports
              ? 'Con denuncias'
              : 'Sin denuncias'}
        </Button>
        <Button
          size="sm"
          variant={filtros.needsRevalidation === undefined ? 'outline' : 'default'}
          onClick={() =>
            onCambiar({ needsRevalidation: alternarTerciario(filtros.needsRevalidation) })
          }
          data-testid="filtro-revalidacion"
        >
          {filtros.needsRevalidation === undefined
            ? 'Revalidación: todas'
            : filtros.needsRevalidation
              ? 'Requieren revalidación'
              : 'Conformes'}
        </Button>

        {/* PUNTO 6 · RÁFAGA A — EL EJE PROPIO DEL AVISO, y el que convierte esta lista
            en el banco de pruebas. Sin poder listar por detector, el modo avisar sería
            un aviso que sólo se ve abriendo fichas de una en una: nadie lo leería, y no
            habría forma de medir cuánto se equivoca un detector antes de dejarle
            bloquear. Es la mitad de por qué las detecciones se persisten.

            Molde de `hasReports`: tres posiciones, porque «sin avisos» también es una
            pregunta. Y es INDEPENDIENTE de los dos ejes de P1 que hay más arriba —
            «los revisados que además tienen un teléfono» se pide combinando los tres. */}
        <Button
          size="sm"
          variant={filtros.hasDetections === undefined ? 'outline' : 'default'}
          onClick={() => onCambiar({ hasDetections: alternarTerciario(filtros.hasDetections) })}
          data-testid="filtro-detecciones"
        >
          {filtros.hasDetections === undefined
            ? 'Avisos: todos'
            : filtros.hasDetections
              ? 'Con avisos'
              : 'Sin avisos'}
        </Button>
        <div>
          <label htmlFor="filtro-detector" className="mb-1 block text-xs text-muted-foreground">
            Detector
          </label>
          <select
            id="filtro-detector"
            value={filtros.detector ?? ''}
            onChange={(e) =>
              onCambiar({
                detector: (e.target.value || undefined) as AdminListingsFilters['detector'],
              })
            }
            className="h-9 rounded-md border bg-background px-2 text-sm"
            data-testid="filtro-detector"
          >
            <option value="">Cualquiera</option>
            {Object.entries(DETECTOR_LABELS).map(([valor, texto]) => (
              <option key={valor} value={valor}>
                {texto}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-2">
        <span className="text-xs text-muted-foreground" data-testid="filtros-total">
          {total} resultado{total === 1 ? '' : 's'}
        </span>
        {/* El vendedor no tiene selector propio: se llega desde la ficha de un
            anuncio («ver todo lo de este vendedor»), que es la tarea real. Aquí
            sólo se muestra que está puesto y se puede quitar. */}
        {filtros.sellerId && (
          <Badge variant="secondary" className="gap-1" data-testid="filtro-vendedor-activo">
            Filtrado por vendedor
            <button
              type="button"
              onClick={() => onCambiar({ sellerId: undefined })}
              aria-label="Quitar el filtro de vendedor"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        )}
        {hayFiltros(filtros) && (
          <Button size="sm" variant="ghost" onClick={onLimpiar} data-testid="filtros-limpiar">
            Limpiar filtros
          </Button>
        )}
      </div>
    </div>
  );
}
