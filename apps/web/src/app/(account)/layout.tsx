import Link from 'next/link';

const navItems = [
  { href: '/mis-anuncios', label: 'Mis anuncios' },
  { href: '/publicar', label: 'Publicar anuncio' },
  { href: '/mensajes', label: 'Mensajes' },
  { href: '/favoritos', label: 'Favoritos' },
  { href: '/notificaciones', label: 'Notificaciones' },
  { href: '/perfil', label: 'Mi perfil' },
  { href: '/perfil/suscripcion', label: 'Mi suscripción' },
  { href: '/mis-creditos', label: 'Mis créditos' },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container mx-auto flex min-h-screen gap-8 px-4 py-8">
      <aside className="w-56 shrink-0">
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
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
      <main className="flex-1">{children}</main>
    </div>
  );
}
