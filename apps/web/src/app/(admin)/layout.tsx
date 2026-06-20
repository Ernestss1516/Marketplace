import Link from 'next/link';

const adminNav = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/anuncios', label: 'Anuncios' },
  { href: '/admin/usuarios', label: 'Usuarios' },
  { href: '/admin/reportes', label: 'Reportes' },
  { href: '/admin/categorias', label: 'Categorías' },
  { href: '/admin/ajustes', label: 'Ajustes' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r bg-muted/30 p-4">
        <div className="mb-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Admin
        </div>
        <nav className="flex flex-col gap-1">
          {adminNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm hover:bg-muted"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
