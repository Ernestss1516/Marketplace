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
  /**
   * ¿Se abre en una pestaña nueva? OMITIDO = como hasta ahora (externo sí, interno no), así
   * que ningún consumidor previo cambia de comportamiento.
   *
   * Existe porque el bloque de publicidad lo deja elegir al editor, y esa elección es
   * ORTOGONAL a interno/externo: un banner puede querer abrir una página propia fuera, o
   * llevarse al lector a un patrocinador sin sacarlo del sitio.
   *
   * LO QUE NO ELIGE ES EL `rel`: ver abajo.
   */
  newTab?: boolean;
  /**
   * Se reenvía al `<Link>` interno; en la rama externa no aplica (un `<a>` no
   * precarga). Declarado EXPLÍCITAMENTE y no colado por `rest` porque `prefetch`
   * no es un atributo de `<a>`: sin esta línea, TypeScript lo rechaza.
   *
   * Existe para poder apagar la precarga donde el bug del router de Next 15
   * (#57565) muerde — ver el comentario de MainNav.tsx. Por defecto se deja como
   * lo deje Next, que es lo que quiere el resto de consumidores.
   */
  prefetch?: boolean;
};

/**
 * `target="_blank"` ⇒ `rel="noopener noreferrer"`, SIEMPRE. **Un solo sitio, y no
 * negociable.**
 *
 * Sin `noopener`, la página de destino recibe un `window.opener` con el que puede reescribir
 * la nuestra —tabnabbing—, y basta con que se olvide UNA vez en UN `<a>` para abrirlo.
 *
 * SE COMPONE CON EL `rel` DEL LLAMANTE en vez de dejar que lo pise, que es lo que pasaba
 * antes: el `{...rest}` iba DESPUÉS de `rel`, así que un consumidor que pasara `rel`
 * —legítimamente, p. ej. `sponsored` en un enlace publicitario— se llevaba por delante la
 * protección sin enterarse. Ahora los tokens se suman y los obligatorios no se pueden quitar.
 */
function relSeguro(relDelLlamante: string | undefined, abreEnNueva: boolean): string | undefined {
  const tokens = new Set((relDelLlamante ?? '').split(/\s+/).filter(Boolean));
  if (abreEnNueva) {
    tokens.add('noopener');
    tokens.add('noreferrer');
  }
  return tokens.size > 0 ? [...tokens].join(' ') : undefined;
}

export const SmartLink = forwardRef<HTMLAnchorElement, SmartLinkProps>(function SmartLink(
  { href, external, newTab, prefetch, children, rel, ...rest },
  ref,
) {
  const esExterno = external ?? isExternalHref(href);
  const abreEnNueva = newTab ?? esExterno;
  const target = abreEnNueva ? '_blank' : undefined;
  const relFinal = relSeguro(rel, abreEnNueva);

  if (esExterno) {
    return (
      <a ref={ref} href={href} target={target} rel={relFinal} {...rest}>
        {children}
      </a>
    );
  }

  // Un interno también puede abrirse fuera si se pide — y entonces necesita el mismo `rel`,
  // por el mismo motivo: la protección la decide el `target`, no el origen del destino.
  return (
    <Link ref={ref} href={href} prefetch={prefetch} target={target} rel={relFinal} {...rest}>
      {children}
    </Link>
  );
});
