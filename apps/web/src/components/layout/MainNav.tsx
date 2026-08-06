import { SmartLink } from '@/components/shared/SmartLink';
import { getCachedNav, type NavNode, type NavPageType } from '@/lib/api/nav';
import { NavDropdown } from './NavDropdown';

const LINK_CLS =
  'shrink-0 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground';

/** Nodo raíz sin hijos: un enlace suelto. Mismo reparto external/interno que
 *  Footer.tsx — literalmente el mismo componente desde RP.2. `external` va
 *  explícito porque lo resuelve el backend (NavItemType), no el href.
 *  `href` nunca es null aquí: un nodo raíz sin destino se pinta como
 *  desplegable, no como enlace. */
function TopLevelLink({ node }: { node: NavNode }) {
  return (
    <SmartLink href={node.href!} external={node.external} className={LINK_CLS}>
      {node.label}
    </SmartLink>
  );
}

/**
 * Barra de navegación configurable, bajo el header del sitio público.
 *
 * Server Component async, como Footer: el árbol llega YA podado por el gate
 * recursivo del backend y con el `href` resuelto, así que aquí no se
 * reimplementa la semántica de los tipos de destino — solo se distingue
 * external (pestaña nueva) de interno (<Link>).
 *
 * Si el backend falla, `.catch(() => [])` deja la página sin barra pero
 * entera — un backend caído nunca rompe el sitio (misma red de seguridad que
 * el footer).
 *
 * El `pageType` lo declara el layout anidado que monta este componente; no se
 * deriva del pathname, que obligaría a hacer la barra cliente y a leer
 * `headers()` en el layout, matando el ISR de todo (public). Ver
 * docs/diseno-nav-dinamico.md §4.1-4.2.
 */
export default async function MainNav({ pageType }: { pageType: NavPageType }) {
  const nodes = await getCachedNav(pageType).catch(() => []);

  // GATE TOTAL: sin nada visible no se pinta NADA — ni <nav>, ni contenedor, ni
  // borde inferior. A diferencia del footer, que conserva su copyright cuando
  // no hay columnas, aquí la barra no debe dejar rastro (diseño §5.2).
  if (nodes.length === 0) return null;

  return (
    <nav aria-label="Navegación principal" className="border-b bg-background">
      {/* Sin sticky a propósito: el header ya lo es (top-0 z-50) y pegar una
          segunda barra obligaría a duplicar su altura como `top-16` en otro
          fichero. Ver diseño §4.4.
          En móvil la barra scrolla en horizontal en vez de plegarse a un menú
          propio: es el comportamiento más simple que no esconde enlaces. */}
      <div className="container mx-auto flex items-center gap-1 overflow-x-auto px-4">
        {nodes.map((node, idx) =>
          node.children.length > 0 ? (
            <NavDropdown key={`${node.href ?? node.label}-${idx}`} node={node} />
          ) : (
            <TopLevelLink key={`${node.href ?? node.label}-${idx}`} node={node} />
          ),
        )}
      </div>
    </nav>
  );
}
