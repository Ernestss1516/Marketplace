import Link from 'next/link';
import { forwardRef, type AnchorHTMLAttributes } from 'react';

/**
 * Enlace interno o externo, con el reparto que el proyecto repetía en cuatro
 * sitios: relativo → `<Link>` del App Router; absoluto → `<a target="_blank"
 * rel="noopener noreferrer">`.
 *
 * FIRMA DE PROPS PLANAS, sin ningún tipo de bloque — es lo que lo hace
 * compartible entre el motor de bloques del blog y el de portada sin acoplarlos
 * (docs/diseno-portada.md §4.0). El acoplamiento no lo produce el JSX, lo
 * produce el tipo: en cuanto una firma menciona `CtaBlock`, quien la use hereda
 * el sistema de tipos del blog.
 *
 * `external` OPCIONAL, y ese matiz es el que reconcilia los cuatro usos: NO
 * eran copias idénticas.
 *   · El blog lo DERIVA del href (`!href.startsWith('/')`), porque un bloque
 *     guarda una cadena suelta validada con @IsSafeContentUrl.
 *   · El footer y el nav lo RECIBEN ya resuelto del backend (`item.external`,
 *     `node.external`), que es quien conoce la semántica de FooterItemType /
 *     NavItemType.
 * Pasarlo explícito gana; omitirlo cae a la heurística. Así ninguno de los dos
 * cambia de comportamiento al unificarse.
 *
 * `forwardRef` + spread de `rest` NO son adorno: sin ellos este componente no
 * puede usarse dentro de un `asChild` de Radix (Slot clona el hijo y le fusiona
 * className, ref y handlers; un intermedio que no los reenvíe se los traga en
 * silencio). Ver la nota de NavDropdown.tsx sobre ese mismo riesgo.
 */

/** Relativo ("/publicar") = interno. Absoluto = externo. */
export function isExternalHref(href: string): boolean {
  return !href.startsWith('/');
}

type SmartLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  /** Omitido = se deriva del href con `isExternalHref`. */
  external?: boolean;
};

export const SmartLink = forwardRef<HTMLAnchorElement, SmartLinkProps>(function SmartLink(
  { href, external, children, ...rest },
  ref,
) {
  if (external ?? isExternalHref(href)) {
    return (
      <a ref={ref} href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }

  return (
    <Link ref={ref} href={href} {...rest}>
      {children}
    </Link>
  );
});
