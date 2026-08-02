'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, Check, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { TagRef } from '@/types';

/**
 * B2 — paso de etiquetas del wizard. Hermano de `StepAtributos`, no parte de él.
 *
 * Los tags NO son obligatorios: este paso nunca bloquea por "falta". Lo único que
 * puede bloquear es pasarse del tope, y la UI ya lo impide desactivando los que no
 * están marcados al llegar al límite — la validación del wizard existe por si el
 * estado queda obsoleto tras idas y venidas, igual que la de los selects vinculados.
 *
 * El orden lo da `available`, que llega del backend con los PROPIOS de la categoría
 * antes que los heredados del padre (resolveEffectiveTags). No se reordena aquí.
 */

/** A partir de este número de tags aparece el buscador; por debajo estorba más que ayuda. */
const UMBRAL_BUSCADOR = 12;

interface StepTagsProps {
  available: TagRef[];
  /** Slugs marcados. Slugs y no ids: es lo que viaja al backend y lo que se indexa. */
  selected: string[];
  max: number;
  onChange: (slugs: string[]) => void;
  errors: Record<string, string>;
}

export function StepTags({ available, selected, max, onChange, errors }: StepTagsProps) {
  const [q, setQ] = useState('');

  const visibles = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? available.filter((t) => t.name.toLowerCase().includes(needle)) : available;
  }, [available, q]);

  // Esta rama no debería verse nunca: el wizard OMITE el paso cuando no hay tags
  // (misma regla de desaparición que 'atributos'). Se deja por si se renderiza
  // suelto, con el mismo tono que StepAtributos.
  if (available.length === 0) {
    return (
      <div className="space-y-2 py-4 text-center text-sm text-muted-foreground">
        <p>Esta categoría no tiene etiquetas disponibles.</p>
      </div>
    );
  }

  const enElTope = selected.length >= max;

  function toggle(slug: string) {
    if (selected.includes(slug)) {
      onChange(selected.filter((s) => s !== slug));
    } else if (!enElTope) {
      // El orden de `available` manda también en lo seleccionado, para que el
      // payload no dependa de en qué orden fue haciendo clic el usuario.
      const next = new Set([...selected, slug]);
      onChange(available.filter((t) => next.has(t.slug)).map((t) => t.slug));
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Etiquetas</h2>
        <p className="text-sm text-muted-foreground">
          Opcional. Ayudan a que tu anuncio aparezca en las búsquedas de quien busca
          justo eso.
        </p>
      </div>

      {available.length >= UMBRAL_BUSCADOR && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar etiqueta…"
            aria-label="Buscar etiqueta"
            className="pl-9"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2" data-testid="step-tags-opciones">
        {visibles.map((tag) => {
          const activo = selected.includes(tag.slug);
          const bloqueado = !activo && enElTope;
          return (
            <button
              key={tag.slug}
              type="button"
              onClick={() => toggle(tag.slug)}
              disabled={bloqueado}
              aria-pressed={activo}
              title={bloqueado ? `Ya has elegido el máximo de ${max}` : undefined}
              className={[
                'flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition-colors',
                activo
                  ? 'border-primary bg-primary text-primary-foreground'
                  : bloqueado
                    ? 'cursor-not-allowed border-border opacity-40'
                    : 'border-border hover:border-primary/50 hover:bg-accent',
              ].join(' ')}
            >
              {activo && <Check className="h-3.5 w-3.5 shrink-0" />}
              {tag.name}
            </button>
          );
        })}
        {visibles.length === 0 && (
          <p className="text-sm text-muted-foreground">Ninguna coincide con la búsqueda.</p>
        )}
      </div>

      <p className="text-xs text-muted-foreground" data-testid="step-tags-contador">
        {selected.length}/{max} etiquetas
        {enElTope && ' — has llegado al máximo'}
      </p>

      {errors.tags && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {errors.tags}
        </p>
      )}
    </div>
  );
}
