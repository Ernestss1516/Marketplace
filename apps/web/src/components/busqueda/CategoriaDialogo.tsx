'use client';

import * as React from 'react';
import { DialogoFiltrable, type OpcionFiltrable } from '@/components/ui/dialogo-filtrable';
import { aplanarArbol } from '@/lib/category-tree';
import type { Category } from '@/types';

/**
 * ══ BUSCADOR · BQ-B — EL DIÁLOGO DE CATEGORÍA ════════════════════════════════════════
 *
 * Adaptador de dominio: traduce el ÁRBOL de categorías a la lista plana que
 * `DialogoFiltrable` entiende. Todo lo que sabe de categorías vive aquí, y por eso el
 * molde no sabe nada (`docs/diseno-buscador.md` §3).
 *
 * ── QUÉ CIERRA: LOS NIVELES 3 Y 4, QUE ERAN INALCANZABLES ─────────────────────────
 *
 * El `<select>` al que sustituye pintaba DOS niveles —las raíces como `<optgroup>` y sus
 * hijas como `<option>`—, así que una categoría de nivel 3 o 4 no aparecía. No era un
 * descuido: **el estándar HTML no permite anidar `<optgroup>`**, y un `<select>` nativo no
 * expresa más de dos niveles de agrupación. El árbol, en cambio, admite
 * `CATEGORY_MAX_DEPTH` = 4, y el filtro del backend los soporta desde PROFUNDIDAD N ·
 * RÁFAGA 2 (`categoryPath` es la cadena ENTERA de ancestros). Era una limitación del
 * CONTROL, nunca del dato — y un diálogo no la tiene.
 *
 * ── LA LISTA ES PLANA, NO UN NAVEGADOR POR NIVELES ────────────────────────────────
 *
 * `StepCategoria` (el wizard de publicar) sí es un navegador, y hace bien: publicar es
 * ELEGIR explorando. Aquí es SALTAR a una categoría que ya conoces, y para eso una lista
 * plana con toda la profundidad a la vista gana a bajar tres niveles. El argumento estaba
 * ya escrito en `CategorySelect`, que resolvió lo mismo para `/busqueda`.
 *
 * ── SE PUEDE ELEGIR UN PADRE, Y SIGUE SIENDO LO CORRECTO ──────────────────────────
 *
 * El `<select>` ofrecía «Todo en Vehículos» además de cada hija, y el filtro es jerárquico
 * por construcción: `categoryPath` contiene la cadena de ancestros, así que elegir
 * «Vehículos» devuelve también los coches. Con la lista aplanada **todos** los nodos son
 * elegibles, a cualquier profundidad: la decisión no sólo se respeta, se completa.
 *
 * El literal «Todo en …» desaparece —en una lista de cuatro niveles se leería peor que el
 * nombre— y lo sustituye una nota atenuada con cuántas subcategorías cuelgan (decisión 6
 * del diseño). Dice lo mismo que decía, y además cuánto.
 */

/** Separador de la ruta de ancestros. El mismo que `CategorySelect` usa en `/busqueda`. */
const SEPARADOR = ' › ';

/**
 * ⚠ EL FILTRO BUSCA EN EL NOMBRE Y MUESTRA LA RUTA, y no es un detalle de presentación.
 *
 * Si `buscable` fuera la ruta completa, teclear «veh» devolvería **toda la rama de
 * Vehículos** —el nodo y todos sus descendientes, porque todos la llevan en su path— y con
 * cuatro niveles eso son decenas de filas. El filtro dejaría de filtrar justo en el caso
 * más común: teclear el nombre de una categoría raíz.
 *
 * `buscableAmplio` es la red: si el nombre no casa con NADA, el molde reintenta sobre la
 * ruta antes de enseñar el vacío. Cubre a quien teclea «vehiculos coches».
 *
 * ⚠ Y ESA RED SE UNE CON ESPACIOS, NO CON « › ». Es una clave de BÚSQUEDA, no una
 * etiqueta: con el separador dentro, «vehiculos coches» no casaría con
 * «vehiculos › coches» y la red no cubriría al único caso para el que existe. Lo que se
 * MUESTRA sigue llevando el separador — eso es `contexto`.
 */
function aOpciones(categories: Category[]): OpcionFiltrable[] {
  return aplanarArbol(categories).map(({ slug, nombre, ancestros, nDescendientes }) => ({
    valor: slug,
    etiqueta: nombre,
    contexto: ancestros.length > 0 ? ancestros.join(SEPARADOR) : undefined,
    nota:
      nDescendientes > 0
        ? `y ${nDescendientes} ${nDescendientes === 1 ? 'subcategoría' : 'subcategorías'}`
        : undefined,
    buscable: nombre,
    buscableAmplio: [...ancestros, nombre].join(' '),
  }));
}

export function CategoriaDialogo({
  categories,
  valor,
  onElegir,
  etiquetaVacio = 'Categoría',
  className,
}: {
  /** Árbol completo, tal como lo sirve `GET /categories`. Ya viaja con la página. */
  categories: Category[];
  valor: string;
  /**
   * Qué pasa al elegir. **Este adaptador no lo decide, y ahí está su reutilización**: BQ-E
   * le trajo un segundo cliente que hace algo distinto con el mismo slug.
   *
   *   · `SearchBar` (portada)      → escribe el slug en el estado del buscador; quien
   *     navega —a la ruta canónica de A1, con el `?tags=` de B4— es `navegar()` al enviar;
   *   · `CategorySelect` (/busqueda y /[categoria]) → NAVEGA en el acto, con el carry de
   *     filtros de A2 (`lib/filter-carry.ts`).
   *
   * Lo que este fichero sabe —aplanar el árbol, filtrar por el nombre y enseñar la ruta—
   * es idéntico para los dos.
   */
  onElegir: (slug: string) => void;
  /**
   * Lo que muestra el disparador cuando no hay ninguna elegida.
   *
   * En la portada es «Categoría» —el control va suelto entre otros tres y tiene que
   * decir qué es—. En el panel de filtros de `/busqueda` la sección ya se titula
   * «CATEGORÍA» dos líneas más arriba, así que repetirlo no informa de nada y además
   * PERDERÍA lo que el `<select>` sí decía: «Todas las categorías», o sea que ahora
   * mismo no hay filtro. Por eso es un parámetro y no una constante.
   *
   * ⚠ NO es el nombre accesible: ése lo pone `etiquetaDisparador` y sigue siendo
   * «Categoría» en los dos sitios, que es el contrato de los tests (§10.2 del diseño).
   */
  etiquetaVacio?: string;
  /** Geometría del disparador. La decide quien lo monta — ver `DialogoFiltrable`. */
  className?: string;
}) {
  // El árbol es estable durante toda la vida de la página (baja por props desde el Server
  // Component), pero el aplanado recorre N nodos y se pinta en cada render del buscador —
  // que teclear en el campo de texto provoca en cada letra.
  const opciones = React.useMemo(() => aOpciones(categories), [categories]);

  return (
    <DialogoFiltrable
      opciones={opciones}
      valor={valor}
      onElegir={onElegir}
      etiquetaVacio={etiquetaVacio}
      opcionLimpiar="Todas las categorías"
      titulo="Elige una categoría"
      marcadorFiltro="Filtrar categorías…"
      etiquetaDisparador="Categoría"
      className={className}
    />
  );
}
