import Link from 'next/link';
import { LayoutGrid, Rows3, Map } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ListingViewMode } from '@/types';

const VIEW_META: Record<ListingViewMode, { label: string; icon: typeof LayoutGrid }> = {
  LISTA: { label: 'Lista', icon: LayoutGrid },
  AMPLIADA: { label: 'Ampliada', icon: Rows3 },
  MAPA: { label: 'Mapa', icon: Map },
};

interface ViewSwitcherProps {
  /** Vistas que esta categoría permite (o las 3, en /busqueda general) — el menú. */
  allowedViews: ListingViewMode[];
  currentView: ListingViewMode;
  /** El caller construye la URL (preserva filtros, resetea página) — este
   * componente solo decide QUÉ vistas mostrar, no CÓMO se codifica en la URL. */
  buildUrl: (view: ListingViewMode) => string;
}

/**
 * Selector de vista (RÁFAGA 2): ofrece solo las vistas que la categoría
 * permite — la categoría define el menú, el usuario elige del menú. La vista
 * elegida viaja en la URL (`?view=`), igual que el resto de filtros — no en
 * localStorage, para que un enlace compartido conserve la vista con la que se
 * miró el resultado.
 */
export function ViewSwitcher({ allowedViews, currentView, buildUrl }: ViewSwitcherProps) {
  // Nada que elegir con 0-1 vistas permitidas — el switcher no aporta nada.
  if (allowedViews.length <= 1) return null;

  return (
    <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Cambiar vista">
      {allowedViews.map((view, i) => {
        const { label, icon: Icon } = VIEW_META[view];
        const active = view === currentView;
        return (
          <Button
            key={view}
            variant={active ? 'secondary' : 'ghost'}
            size="sm"
            className={`rounded-none ${i < allowedViews.length - 1 ? 'border-r' : ''}`}
            asChild
          >
            <Link href={buildUrl(view)} aria-current={active ? 'page' : undefined}>
              <Icon className="mr-1.5 h-4 w-4" />
              {label}
            </Link>
          </Button>
        );
      })}
    </div>
  );
}
