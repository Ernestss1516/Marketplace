import Link from 'next/link';
import { SITE_NAME } from '@/config';
import { getCachedFooterPages } from '@/lib/api/blog';

export default async function Footer() {
  // Fuente única: la BD, vía un cache dedicado (nunca una query por request —
  // ver getCachedFooterPages). Si falla (backend caído, etc.), el footer sigue
  // funcionando con los enlaces estáticos — nunca rompe el sitio por esto.
  const footerPages = await getCachedFooterPages().catch(() => []);

  return (
    <footer className="border-t py-10">
      <div className="container mx-auto flex flex-col items-center gap-4 px-4 text-sm text-muted-foreground md:flex-row md:justify-between">
        <span>© {new Date().getFullYear()} {SITE_NAME}. Todos los derechos reservados.</span>
        <nav className="flex flex-wrap justify-center gap-4">
          <Link href="/busqueda" className="hover:text-foreground">Buscar</Link>
          <Link href="/publicar" className="hover:text-foreground">Publicar</Link>
          <Link href="/login" className="hover:text-foreground">Acceder</Link>
          {footerPages.map((p) => (
            <Link key={p.slug} href={`/paginas/${p.slug}`} className="hover:text-foreground">
              {p.title}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
