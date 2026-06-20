import Link from 'next/link';
import { SITE_NAME } from '@/config';

export default function Footer() {
  return (
    <footer className="border-t py-10">
      <div className="container mx-auto flex flex-col items-center gap-4 px-4 text-sm text-muted-foreground md:flex-row md:justify-between">
        <span>© {new Date().getFullYear()} {SITE_NAME}. Todos los derechos reservados.</span>
        <nav className="flex gap-4">
          <Link href="/busqueda" className="hover:text-foreground">Buscar</Link>
          <Link href="/publicar" className="hover:text-foreground">Publicar</Link>
          <Link href="/login" className="hover:text-foreground">Acceder</Link>
        </nav>
      </div>
    </footer>
  );
}
