'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { cn } from '@/lib/utils';

const NAV_ITEMS: { href: string; label: string; roles: string[] }[] = [
  { href: '/admin',            label: 'Dashboard',    roles: ['ADMIN'] },
  { href: '/admin/anuncios',   label: 'Anuncios',     roles: ['ADMIN'] },
  { href: '/admin/usuarios',   label: 'Usuarios',     roles: ['ADMIN'] },
  { href: '/admin/reportes',   label: 'Reportes',     roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/facturacion',label: 'Facturación',  roles: ['ADMIN'] },
  { href: '/admin/categorias', label: 'Categorías',   roles: ['ADMIN'] },
  { href: '/admin/blog',       label: 'Blog',         roles: ['ADMIN'] },
  { href: '/admin/ajustes',    label: 'Ajustes',      roles: ['ADMIN'] },
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
