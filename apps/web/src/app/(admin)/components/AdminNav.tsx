'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { cn } from '@/lib/utils';

const NAV_ITEMS: { href: string; label: string; roles: string[] }[] = [
  { href: '/admin',             label: 'Dashboard',    roles: ['ADMIN'] },
  { href: '/admin/anuncios',    label: 'Anuncios',     roles: ['ADMIN', 'MODERATOR'] },
  // MODERACIÓN M3 — la cola va junto a Anuncios: es trabajo PENDIENTE, no una
  // vista de consulta. Antes su sitio era filtrar «En revisión» en Anuncios, y de
  // ahí salía que el moderador despachara con el selector de estado genérico.
  { href: '/admin/moderacion',  label: 'Cola de revisión', roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/usuarios',    label: 'Usuarios',     roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/reportes',    label: 'Reportes',     roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/tickets',     label: 'Tickets',      roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/facturacion', label: 'Facturación',  roles: ['ADMIN'] },
  { href: '/admin/facturas',    label: 'Facturas',     roles: ['ADMIN'] },
  { href: '/admin/categorias',  label: 'Categorías',   roles: ['ADMIN'] },
  // B1 — el catálogo de tags es config del vocabulario, junto a Categorías.
  { href: '/admin/tags',        label: 'Tags',         roles: ['ADMIN'] },
  { href: '/admin/blog',        label: 'Blog',         roles: ['ADMIN', 'MODERATOR', 'EDITOR'] },
  { href: '/admin/paginas',     label: 'Páginas',      roles: ['ADMIN', 'MODERATOR', 'EDITOR'] },
  { href: '/admin/footer',      label: 'Footer',       roles: ['ADMIN'] },
  // RN.4 — junto a Footer: son las dos navegaciones configurables del sitio.
  { href: '/admin/nav',         label: 'Navegación',   roles: ['ADMIN'] },
  // RP.3 — junto a Footer y Navegación: las tres son CONFIGURACIÓN del sitio
  // (solo ADMIN), no contenido como Blog/Páginas (que sí abren a EDITOR).
  { href: '/admin/portada',     label: 'Portada',      roles: ['ADMIN'] },
  { href: '/admin/campaigns',   label: 'Campañas',     roles: ['ADMIN'] },
  { href: '/admin/cupones',     label: 'Cupones',      roles: ['ADMIN'] },
  { href: '/admin/banners',     label: 'Banners',      roles: ['ADMIN'] },
  { href: '/admin/sponsored-ads', label: 'Patrocinados', roles: ['ADMIN'] },
  { href: '/admin/mensajes-contacto', label: 'Mensajes de contacto', roles: ['ADMIN'] },
  { href: '/admin/ajustes',     label: 'Ajustes',      roles: ['ADMIN'] },
];

export function AdminNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user.role ?? '';

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <nav className="flex flex-col gap-1" data-testid="admin-nav">
      {visibleItems.map((item) => {
        const isActive =
          item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'rounded-md px-3 py-2 text-sm transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground font-medium'
                : 'hover:bg-muted text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
