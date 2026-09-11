'use client';

import * as React from 'react';

/**
 * ══ LA ZONA, TAMBIÉN PARA LO QUE SE PORTALEA ═════════════════════════════════════════
 *
 * ── EL PROBLEMA, MEDIDO EN E6 (§5.2 del diseño) ──────────────────────────────────────
 *
 * Una zona funciona POR HERENCIA: sus tokens se declaran en un `[data-zona="…"]` que
 * envuelve el árbol de la zona (`bloqueDeEstilo`, en `lib/estilo-css.ts`), y una custom
 * property declarada en un elemento manda en todo su subárbol. No hace falta nada más.
 *
 * **Un portal rompe justo eso.** Los diálogos, menús y desplegables de Radix se montan
 * en `<body>` —FUERA del envoltorio de la zona—, así que reciben los tokens de la BASE
 * aunque la página esté en una zona que los ajusta. No es teoría: una sonda en el
 * navegador devolvió `--motion-duration: 150ms` dentro del cajón del backoffice,
 * estando la página en la zona que lo baja a 100.
 *
 * ── LA SOLUCIÓN ES EL MECANISMO DE SIEMPRE, NO UNO NUEVO (§402) ──────────────────────
 *
 * El contenido portalado declara SU PROPIA `data-zona`. Con eso el bloque
 * `[data-zona="backoffice"]` vuelve a casar con un ancestro suyo —él mismo— y las custom
 * properties mandan otra vez en su subárbol. Se recupera la herencia que el portal se
 * había saltado; no se inventa ninguna semántica.
 *
 * LA VÍA QUE SE DESCARTA, y estaba anotada en `pendientes.md`: emitir cada bloque
 * también como `:root:has([data-zona="x"])`. Habría funcionado, pero cambia el mecanismo
 * de E5 de «subárbol» a «documento» —y con él el caso del blog, que vive DENTRO del
 * público y hoy hereda de él por cascada—. Eso es una decisión sobre lo que E5 aprobó,
 * no un arreglo de un fleco.
 *
 * ── DE DÓNDE SALE LA ZONA DE UN OVERLAY GENÉRICO ─────────────────────────────────────
 *
 * Los dos cajones (`AdminMobileNav`, `AccountMobileBar`) pertenecen a una zona POR
 * CONSTRUCCIÓN y se la escriben a mano; eso cerró E6 para ellos. `dialog`,
 * `alert-dialog`, `dropdown-menu` y `select` son genéricos: el mismo componente se abre
 * en el backoffice, en la cuenta y en el blog, y no puede saber dónde está.
 *
 * Se lo dice este contexto. **Un portal mueve el árbol del DOM, no el de React**: un
 * `DialogContent` escrito dentro del backoffice sigue siendo, en React, descendiente del
 * layout del backoffice, aunque su nodo acabe colgando de `<body>`. O sea que el
 * contexto entrega exactamente lo que hace falta —la zona DESDE LA QUE SE ABRIÓ— por la
 * misma vía por la que la cascada lo entregaría si el portal no existiera.
 *
 * ── POR QUÉ UN SOLO COMPONENTE Y NO UN PROVEEDOR APARTE ──────────────────────────────
 *
 * Porque si el atributo y el contexto se declararan en dos sitios, un día dirían cosas
 * distintas: el subárbol en una zona y sus diálogos en otra, sin que nada se pusiera
 * rojo. `<Zona>` es UNA declaración con dos salidas, y no hay forma de poner una sin la
 * otra.
 *
 * ── LA ZONA PÚBLICA NO ESTÁ AQUÍ, Y ES CORRECTO ──────────────────────────────────────
 *
 * `public` es la BASE del modelo: no tiene bloque propio (`ajustesPorZona` no la
 * declara, «un ajuste suyo sería declarar dos veces lo mismo»). Fuera de las cuatro
 * zonas el contexto vale `null`, `data-zona` no se emite, y el overlay hereda de
 * `html:root` — que es justamente lo público.
 */

/**
 * Las cuatro zonas que EXISTEN en el árbol del frontend. Es un subconjunto de
 * `ESTILO_ZONES` del backend (`estilo.constants.ts`), que incluye además `public`: allí
 * es el nombre del registro base, aquí no envuelve nada.
 */
export type NombreDeZona = 'backoffice' | 'blog' | 'cuenta' | 'login';

const ContextoDeZona = React.createContext<NombreDeZona | null>(null);

/**
 * La zona activa, o `undefined` si el árbol no está dentro de ninguna (o sea: público).
 *
 * `undefined` y no una cadena `'public'` por lo mismo que `bloqueDeEstilo` no emite un
 * bloque `public`: con `data-zona={undefined}` React no escribe el atributo, y no
 * escribirlo es exactamente «hereda de la base».
 */
export function useZona(): NombreDeZona | undefined {
  return React.useContext(ContextoDeZona) ?? undefined;
}

type PropsDeZona = React.ComponentPropsWithoutRef<'div'> & { nombre: NombreDeZona };

/**
 * El envoltorio de una zona: pinta el `<div data-zona>` del que cuelga el subárbol Y
 * publica el mismo nombre para lo que se portalee desde dentro.
 *
 * `{...props}` va ANTES de `data-zona` a propósito: así una llamada no puede pisar el
 * atributo y dejar el subárbol en una zona y el contexto en otra.
 */
export function Zona({ nombre, children, ...props }: PropsDeZona) {
  return (
    <ContextoDeZona.Provider value={nombre}>
      <div {...props} data-zona={nombre}>
        {children}
      </div>
    </ContextoDeZona.Provider>
  );
}
