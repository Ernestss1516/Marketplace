import Link from 'next/link';
import { SITE_NAME } from '@/config';
import { auth } from '@/lib/auth';
import { getUnreadNotificationsCount } from '@/lib/api/notificaciones';
import { HeaderAuthNav } from './HeaderAuthNav';

export default async function Header() {
  const session = await auth();
  const token = session?.user.accessToken;
  const initialUnreadCount = token
    ? await getUnreadNotificationsCount(token)
        .then((r) => r.count)
        .catch(() => 0)
    : 0;

  return (
    <header className="sticky top-0 z-50 border-b bg-background">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="text-xl font-bold tracking-tight">
          {SITE_NAME}
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link
            href="/busqueda"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Buscar
          </Link>
          <Link
            href="/publicar"
            className="font-medium text-primary transition-colors hover:text-primary/80"
          >
            Publicar anuncio
          </Link>
          <HeaderAuthNav initialUnreadCount={initialUnreadCount} />
        </nav>
      </div>
    </header>
  );
}
