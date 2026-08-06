'use client';

import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SmartLink } from '@/components/shared/SmartLink';
import type { NavNode } from '@/lib/api/nav';

/**
 * ÚNICO trozo cliente de la barra — misma estrategia que Header (server) +
 * HeaderAuthNav (client): `MainNav` sigue siendo Server Component y solo los
 * nodos CON hijos se hidratan.
 *
 * Radix `DropdownMenu` y no un desplegable CSS-only por hover: da teclado
 * (Enter/Espacio/flechas/Escape), `aria-expanded`/`aria-haspopup`, gestión de
 * foco y cierre al hacer clic fuera. Un `group-hover` no da nada de eso y en
 * táctil directamente no se puede abrir.
 */

const TRIGGER_CLS =
  'flex items-center gap-1 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground';

const CHILD_CLS = 'w-full cursor-pointer';

export function NavDropdown({ node }: { node: NavNode }) {
  // Un nodo con destino Y con hijos se parte en dos controles: el enlace navega
  // y el chevron abre. Así no hay que elegir entre navegar o desplegar, que es
  // el compromiso clásico de las barras de navegación.
  const hasOwnLink = node.href !== null;

  return (
    <div className="flex shrink-0 items-center">
      {hasOwnLink && (
        <SmartLink
          href={node.href!}
          external={node.external}
          className="rounded-md py-2 pl-3 pr-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {node.label}
        </SmartLink>
      )}

      {/* modal={false} a propósito. Con el `modal` por defecto, Radix marca
          `aria-hidden` TODO lo que queda fuera del menú (header, contenido,
          resto de la barra) y bloquea el scroll de la página mientras está
          abierto. Eso es correcto para un diálogo, y erróneo para un menú de
          navegación: dejaría el sitio entero inerte —y ausente del árbol de
          accesibilidad— por desplegar un submenú. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          className={hasOwnLink ? `${TRIGGER_CLS} px-1` : TRIGGER_CLS}
          // Con enlace propio el disparador es solo el chevron, así que necesita
          // nombre accesible propio: el texto visible ya lo consume el enlace.
          aria-label={hasOwnLink ? `Abrir submenú de ${node.label}` : undefined}
        >
          {!hasOwnLink && node.label}
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </DropdownMenuTrigger>

        {/* z-40: por debajo del z-50 del header sticky, que debe seguir ganando. */}
        <DropdownMenuContent align="start" className="z-40 min-w-44">
          {/* `asChild` usa Slot, que fusiona sobre el hijo el role="menuitem",
              los handlers de teclado y el ref con los que Radix gestiona el foco
              dentro del menú. Aquí antes iba un <a>/<Link> INLINE, porque un
              componente propio en medio que NO REENVÍE esas props se las traga
              en silencio: el menú seguiría abriéndose, pero sus ítems dejarían
              de ser `menuitem` y de recorrerse con las flechas.
              `SmartLink` sí las reenvía —es forwardRef y hace spread de todo lo
              que recibe—, que es exactamente el requisito. Lo cubre el test de
              TECLADO de nav-publico.spec.ts, que comprueba `menuitem`, flechas y
              devolución del foco al cerrar.
              `href` nunca es null aquí: el gate del backend poda los nodos de
              segundo nivel sin destino. */}
          {node.children.map((child, idx) => (
            <DropdownMenuItem key={`${child.href}-${idx}`} asChild>
              <SmartLink href={child.href!} external={child.external} className={CHILD_CLS}>
                {child.label}
              </SmartLink>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
