import Link from 'next/link';
import { SITE_NAME } from '@/config';
import { auth } from '@/lib/auth';
import { getUnreadNotificationsCount } from '@/lib/api/notificaciones';
import { getMe } from '@/lib/api/usuarios';
import { HeaderAuthNav } from './HeaderAuthNav';

export default async function Header() {
  const session = await auth();
  const token = session?.user.accessToken;
  const [initialUnreadCount, avatarUrl] = token
    ? await Promise.all([
        getUnreadNotificationsCount(token)
          .then((r) => r.count)
          .catch(() => 0),
        getMe(token)
          .then((u) => u.avatarUrl)
          .catch(() => undefined),
      ])
    : [0, undefined];

  return (
    <header className="sticky top-0 z-50 border-b bg-background">
      {/* UXV.2 — los `shrink-0`, el `gap` escalonado y el rótulo corto de «Publicar» son
          la cabecera cabiendo en 375 px. Antes, con `gap-6` fijo y sin `whitespace-nowrap`,
          el logo y «Buscar» se tocaban y «Publicar anuncio» partía en dos líneas. Se
          notaba poco mientras la cabecera solo existía en la zona pública; al montarla
          también en la de cuenta (A1) pasaba a verse en veinte pantallas más. */}
      <div className="container mx-auto flex h-16 items-center justify-between gap-3 px-4">
        <Link href="/" className="shrink-0 text-xl font-bold tracking-tight">
          {SITE_NAME}
        </Link>
        <nav className="flex items-center gap-3 text-sm sm:gap-6">
          <Link
            href="/busqueda"
            className="shrink-0 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
          >
            Buscar
          </Link>
          <Link
            href="/publicar"
            className="shrink-0 whitespace-nowrap font-medium text-primary transition-colors hover:text-primary/80"
          >
            {/* Mismo destino y mismo enlace: solo cambia cuánto texto cabe. */}
            <span className="sm:hidden">Publicar</span>
            <span className="hidden sm:inline">Publicar anuncio</span>
          </Link>
          <HeaderAuthNav initialUnreadCount={initialUnreadCount} avatarUrl={avatarUrl} />
        </nav>
      </div>
    </header>
  );
}
