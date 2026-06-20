import Link from 'next/link';
import { SITE_NAME } from '@/config';

export default function Header() {
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
          <Link
            href="/login"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Iniciar sesión
          </Link>
        </nav>
      </div>
    </header>
  );
}
