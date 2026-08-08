import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface BreadcrumbItem {
  name: string;
  /** Sin href = eslabón final (dónde estás): se pinta como texto, no como enlace. */
  href?: string;
}

interface Props {
  items: BreadcrumbItem[];
  /** Etiqueta y destino del primer eslabón. Por defecto, la portada. */
  home?: { name: string; href: string };
  className?: string;
}

/**
 * UXV.2 — migas de pan, extraídas del patrón que ya se repetía inline en la zona
 * pública: [`busqueda/page.tsx:240`](../../app/(public)/busqueda/page.tsx),
 * [`CategoryListingPage.tsx:384`](../categorias/CategoryListingPage.tsx) y
 * [`anuncio/[slug]/page.tsx:137`](../../app/(public)/anuncio/[slug]/page.tsx). Mismo
 * marcado y mismo aspecto que aquellas tres: `<nav aria-label="Breadcrumb">`, «Inicio»
 * primero, separador ` / `, último eslabón sin enlace.
 *
 * NO lleva JSON-LD. El helper [`breadcrumb-json-ld.ts`](../../lib/breadcrumb-json-ld.ts)
 * es SEO y lo emiten las páginas públicas por su cuenta; la zona de cuenta no se indexa,
 * así que mezclarlo aquí metería marcado de buscador en pantallas privadas.
 *
 * Las tres páginas públicas siguen con su copia inline: migrarlas toca páginas
 * SEO-críticas cuyo trail alimenta además el JSON-LD, y esta ráfaga es el SHELL de la
 * zona de cuenta. Queda como adopción pendiente, no como patrón nuevo — este componente
 * ES el de ellas.
 */
export function Breadcrumbs({ items, home = { name: 'Inicio', href: '/' }, className }: Props) {
  if (items.length === 0) return null;

  return (
    <nav
      className={cn('text-xs text-muted-foreground', className)}
      aria-label="Breadcrumb"
    >
      <Link href={home.href} className="hover:underline">
        {home.name}
      </Link>
      {items.map((item, i) => (
        <span key={`${item.href ?? item.name}-${i}`}>
          {' / '}
          {item.href && i < items.length - 1 ? (
            <Link href={item.href} className="hover:underline">
              {item.name}
            </Link>
          ) : (
            <span className="line-clamp-1 inline">{item.name}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
