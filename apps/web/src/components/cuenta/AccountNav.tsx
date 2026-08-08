'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ACCOUNT_NAV, findAccountNavItem } from '@/config/account-nav';

interface Props {
  /** Se invoca al pulsar un destino. El drawer de móvil lo usa para cerrarse. */
  onNavigate?: () => void;
}

/**
 * UXV.2 — el menú de la zona de cuenta. Un solo componente para las dos superficies:
 * el `<aside>` fijo de escritorio y el drawer de móvil lo renderizan igual, así que no
 * pueden ofrecer destinos distintos según el tamaño de pantalla.
 *
 * ESTADO ACTIVO (M1): el menú de la cuenta era trece —antes nueve— enlaces idénticos,
 * sin `usePathname` ni `aria-current`: el usuario no podía saber en qué sección estaba.
 * El criterio es el de [`AdminNav`](../../app/(admin)/components/AdminNav.tsx#L45-L46)
 * —prefijo, con exactitud para las raíces de sección— resuelto en `account-nav.ts` para
 * que las migas usen exactamente el mismo.
 */
export function AccountNav({ onNavigate }: Props) {
  const pathname = usePathname();
  // La entrada activa se resuelve UNA vez para todo el menú (coincidencia más larga
  // gana), en vez de que cada ítem se pregunte por su cuenta: si no, en
  // `/mis-anuncios/estadisticas` se marcarían dos.
  const active = findAccountNavItem(pathname);

  return (
    <nav className="flex flex-col gap-6" aria-label="Secciones de mi cuenta">
      {ACCOUNT_NAV.map((group) => (
        <div key={group.title}>
          <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.title}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const isActive = active?.href === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-primary font-medium text-primary-foreground'
                      : 'text-foreground hover:bg-muted',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="flex-1">{item.label}</span>
                  {/* Avisa de que ese destino sale del shell de cuenta (SHELL-D3):
                      /planes es pública y al pisarla cambia la cabecera y desaparece
                      este menú. Mejor anunciarlo que sorprender con ello. */}
                  {item.external && (
                    <ExternalLink className="h-3 w-3 shrink-0 opacity-50" aria-hidden />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
