'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { cn } from '@/lib/utils';
import { matchesSection, navSectionsFor } from '@/config/backoffice-sections';

/**
 * ROLES RÁFAGA 1 — `NAV_ITEMS` VIVÍA AQUÍ Y HA DESAPARECIDO.
 *
 * Era la segunda de las tres listas a mano: 21 ítems con su `roles: string[]`
 * enumerado uno a uno, que había que mantener en paralelo con
 * `ROLE_ALLOWED_PATHS` del middleware. Cuando las dos discrepaban salía uno de
 * los dos defectos que la auditoría documentó: una sección visible que redirige
 * (ítem sin path) o una sección alcanzable que nadie encuentra (path sin ítem —
 * el caso real de `/admin/motivos-contacto`).
 *
 * Ahora este componente **solo pinta**: qué secciones existen, cómo se llaman, en
 * qué orden van y qué rol las ve sale de `config/backoffice-sections.ts`, el mismo
 * fichero del que deriva el middleware. Es imposible que el nav y el gate
 * discrepen porque leen la misma fila.
 *
 * Molde: `config/account-nav.ts` + el `<aside>` de la zona de cuenta (UXV.2).
 */
export function AdminNav() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const visibleSections = navSectionsFor(session?.user.role);

  return (
    <nav className="flex flex-col gap-1" data-testid="admin-nav">
      {visibleSections.map((section) => {
        // El resaltado usa la MISMA regla de pertenencia que el gate. Antes eran
        // dos comparaciones escritas por separado —el `item.href === '/admin' ?
        // … : startsWith(…)` de aquí y el `startsWith` del middleware— que podían
        // discrepar; el caso especial de `/admin` vive ahora en el mapa (`exact`).
        const isActive = matchesSection(pathname, section);

        return (
          <Link
            key={section.id}
            href={section.route}
            className={cn(
              'rounded-md px-3 py-2 text-sm transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground font-medium'
                : 'hover:bg-muted text-foreground',
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
