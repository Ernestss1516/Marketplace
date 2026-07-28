'use client';

import { useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { getCategoryBySlug } from '@/lib/api/categorias';
import type { Category, AttributeSchema, ListingTypePolicy, PriceUnit } from '@/types';

interface CategoryData {
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  attributeSchema: AttributeSchema[];
  allowedListingType: ListingTypePolicy;
  /** RP.3 — formatos de precio EFECTIVOS de la categoría (ya resueltos por el
   *  backend). El wizard los pasa a StepDatos para acotar el selector. */
  allowedPriceUnits: PriceUnit[];
}

interface StepCategoriaProps {
  categories: Category[];
  selected: CategoryData | null;
  onComplete: (data: CategoryData) => void;
}

export function StepCategoria({ categories, selected, onComplete }: StepCategoriaProps) {
  // path = ancestors navigated into (to show their children)
  const [path, setPath] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentLevel = path.length === 0 ? categories : (path[path.length - 1].children ?? []);

  async function handleSelect(cat: Category) {
    if (cat.children && cat.children.length > 0) {
      setPath((prev) => [...prev, cat]);
      return;
    }
    // Leaf: fetch schema and complete
    setLoading(true);
    setError(null);
    try {
      const full = await getCategoryBySlug(cat.slug);
      onComplete({
        categoryId: cat.id,
        categorySlug: cat.slug,
        categoryName: cat.name,
        attributeSchema: full.attributeSchema,
        allowedListingType: full.allowedListingType,
        // Ya resuelto por el backend (propio → padre → default global [ONE_TIME]),
        // igual que allowedListingType. `?? []` cubre una API antigua sin el campo:
        // lista vacía → el selector no se muestra → comportamiento pre-RP.3.
        allowedPriceUnits: full.allowedPriceUnits ?? [],
      });
    } catch {
      setError('No se pudo cargar la categoría. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  function goBack(index: number) {
    setPath((prev) => prev.slice(0, index));
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Elige una categoría</h2>
        <p className="text-sm text-muted-foreground">
          Selecciona la categoría que mejor describe tu anuncio.
        </p>
      </div>

      {/* Breadcrumb */}
      {path.length > 0 && (
        <nav className="flex items-center gap-1 text-sm" aria-label="Ruta de categoría">
          <button
            type="button"
            onClick={() => setPath([])}
            className="text-primary hover:underline"
          >
            Categorías
          </button>
          {path.map((cat, i) => (
            <span key={cat.id} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              {i < path.length - 1 ? (
                <button
                  type="button"
                  onClick={() => goBack(i + 1)}
                  className="text-primary hover:underline"
                >
                  {cat.name}
                </button>
              ) : (
                <span className="font-medium">{cat.name}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      {/* Currently selected indicator */}
      {selected && (
        <p className="text-sm">
          <span className="text-muted-foreground">Seleccionada: </span>
          <span className="font-medium text-primary">{selected.categoryName}</span>
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Cargando categoría…</span>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {currentLevel.map((cat) => {
            const isSelected = selected?.categoryId === cat.id;
            const hasChildren = Boolean(cat.children && cat.children.length > 0);
            return (
              <li key={cat.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(cat)}
                  className={[
                    'flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors hover:border-primary hover:bg-primary/5',
                    isSelected
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background',
                  ].join(' ')}
                >
                  <span>{cat.name}</span>
                  {hasChildren && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
