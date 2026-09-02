import Link from 'next/link';
import { auth } from '@/lib/auth';
import { getCachedBranding } from '@/lib/api/branding';
import { getUnreadNotificationsCount } from '@/lib/api/notificaciones';
import { getMe } from '@/lib/api/usuarios';
import { HeaderAuthNav } from './HeaderAuthNav';
import { SiteBrand } from './SiteBrand';

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

  // LOGOS L2 — la marca configurable. Cacheado por tag (`branding`) y compartido por
  // todas las páginas, así que esto no es una consulta por request; el backend tumba
  // la entrada al cambiar un logo. `.catch(() => null)` es la misma red que el footer
  // y el nav: un backend caído deja la cabecera con el nombre del sitio, que es
  // exactamente lo que se pintaba antes de esta ráfaga.
  const logos = await getCachedBranding().catch(() => null);

  return (
    <header className="sticky top-0 z-50 border-b bg-background">
      {/* UXV.2 — los `shrink-0`, el `gap` escalonado y el rótulo corto de «Publicar» son
          la cabecera cabiendo en 375 px. Antes, con `gap-6` fijo y sin `whitespace-nowrap`,
          el logo y «Buscar» se tocaban y «Publicar anuncio» partía en dos líneas. Se
          notaba poco mientras la cabecera solo existía en la zona pública; al montarla
          también en la de cuenta (A1) pasaba a verse en veinte pantallas más. */}
      <div className="container mx-auto flex h-16 items-center justify-between gap-3 px-4">
        {/* El destino no cambia en el blog: el logo de la cabecera lleva a la portada
            desde cualquier página pública. Lo único que cambia es la imagen. */}
        <Link href="/" className="flex shrink-0 items-center">
          <SiteBrand logos={logos} />
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
