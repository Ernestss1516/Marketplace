'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  matchesSection,
  navGroupsFor,
  type BackofficeSection,
} from '@/config/backoffice-sections';

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
 * qué orden van, EN QUÉ GRUPO CAEN y qué rol las ve sale de
 * `config/backoffice-sections.ts`, el mismo fichero del que deriva el middleware. Es
 * imposible que el nav y el gate discrepen porque leen la misma fila.
 *
 * ─── PUNTO 3: LOS GRUPOS ──────────────────────────────────────────────────────
 *
 * Molde: `components/cuenta/AccountNav.tsx` (UXV.2), que ya resolvió esto para trece
 * entradas — aquí son veintidós. Se copia entero, incluido lo que no se ve:
 *
 *   · **UN SOLO componente para las dos superficies.** El `<aside>` de escritorio y el
 *     drawer de móvil montan este mismo árbol, así que no pueden ofrecer destinos
 *     distintos según el tamaño de pantalla.
 *   · **`onNavigate`** — lo usa el drawer para cerrarse al saltar. Sin eso el panel se
 *     queda abierto encima de la página nueva.
 *
 * **LOS GRUPOS NACEN ABIERTOS.** Plegar es un acto del usuario, nunca el estado de
 * fábrica, y no es una preferencia estética: un menú que esconde destinos por defecto
 * produce lo mismo que el defecto R3 —una sección alcanzable que nadie encuentra—
 * para quien no sepa que hay que abrir el grupo. Que el estado inicial sea «todo
 * visible» es lo que separa «lo tengo recogido» de «no sé que existe».
 */
export function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();

  // Se guardan los PLEGADOS, no los abiertos: así el conjunto vacío —el estado
  // inicial— significa «todos abiertos», y un grupo nuevo nace abierto sin que nadie
  // tenga que acordarse de añadirlo a ninguna lista.
  const [plegados, setPlegados] = useState<ReadonlySet<string>>(new Set());

  const { root, groups } = navGroupsFor(session?.user.role);

  function alternar(id: string) {
    setPlegados((previo) => {
      const siguiente = new Set(previo);
      if (!siguiente.delete(id)) siguiente.add(id);
      return siguiente;
    });
  }

  return (
    <nav className="flex flex-col gap-4" data-testid="admin-nav" aria-label="Secciones del backoffice">
      {/* La RAÍZ, suelta encima de los grupos: `/admin` no es hermana de las demás
          secciones sino el sitio del que cuelgan todas. */}
      {root.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {root.map((section) => (
            <SeccionLink
              key={section.id}
              section={section}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}

      {groups.map((group) => {
        const plegado = plegados.has(group.id);
        return (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => alternar(group.id)}
              aria-expanded={!plegado}
              className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            >
              {group.title}
              <ChevronDown
                className={cn('h-3.5 w-3.5 shrink-0 transition-transform', plegado && '-rotate-90')}
                aria-hidden
              />
            </button>

            {!plegado && (
              <div className="mt-0.5 flex flex-col gap-0.5">
                {group.items.map((section) => (
                  <SeccionLink
                    key={section.id}
                    section={section}
                    pathname={pathname}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function SeccionLink({
  section,
  pathname,
  onNavigate,
}: {
  section: BackofficeSection;
  pathname: string;
  onNavigate?: () => void;
}) {
  // El resaltado usa la MISMA regla de pertenencia que el gate. Antes eran dos
  // comparaciones escritas por separado —el `item.href === '/admin' ? … :
  // startsWith(…)` de aquí y el `startsWith` del middleware— que podían discrepar;
  // el caso especial de `/admin` vive ahora en el mapa (`exact`).
  const isActive = matchesSection(pathname, section);

  return (
    <Link
      href={section.route}
      onClick={onNavigate}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'rounded-md px-3 py-2 text-sm transition-colors',
        isActive ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-muted text-foreground',
      )}
    >
      {section.label}
    </Link>
  );
}
