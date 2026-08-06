import Link from 'next/link';
import { SITE_NAME } from '@/config';
import { SmartLink } from '@/components/shared/SmartLink';
import { getCachedFooterNav } from '@/lib/api/footer';

export default async function Footer() {
  // Fuente única: la BD, vía un cache dedicado (nunca una query por request —
  // ver getCachedFooterNav). Si falla (backend caído, etc.), el footer sigue
  // funcionando con los enlaces estáticos — nunca rompe el sitio por esto.
  const footerColumns = await getCachedFooterNav().catch(() => []);

  return (
    <footer className="border-t py-10">
      {/* Columnas de navegación (FooterColumn/FooterItem) — sección separada de
          la navegación de app de abajo. Grid CSS puro, sin acordeón: mantiene
          Footer como Server Component (sin estado cliente). */}
      {footerColumns.length > 0 && (
        <div className="container mx-auto grid grid-cols-1 gap-8 px-4 pb-8 sm:grid-cols-2 md:grid-cols-4">
          {footerColumns.map((col, idx) => (
            <div key={col.name ?? `__sin-titulo-${idx}`}>
              {col.name && (
                <h3 className="mb-3 text-sm font-semibold text-foreground">{col.name}</h3>
              )}
              <ul className="space-y-2">
                {col.items.map((item) => (
                  <li key={item.href + item.label}>
                    {/* `external` va EXPLÍCITO: aquí no se deriva del href, lo
                        resuelve el backend según FooterItemType (ver
                        FooterService.listPublicNav). SmartLink respeta el que se
                        le pasa y solo deriva cuando se omite. */}
                    <SmartLink
                      href={item.href}
                      external={item.external}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      {item.label}
                    </SmartLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div
        className={`container mx-auto flex flex-col items-center gap-4 px-4 text-sm text-muted-foreground md:flex-row md:justify-between ${
          footerColumns.length > 0 ? 'border-t pt-6' : ''
        }`}
      >
        <span>© {new Date().getFullYear()} {SITE_NAME}. Todos los derechos reservados.</span>
        <nav className="flex flex-wrap justify-center gap-4">
          <Link href="/busqueda" className="hover:text-foreground">Buscar</Link>
          <Link href="/publicar" className="hover:text-foreground">Publicar</Link>
          <Link href="/login" className="hover:text-foreground">Acceder</Link>
        </nav>
      </div>
    </footer>
  );
}
