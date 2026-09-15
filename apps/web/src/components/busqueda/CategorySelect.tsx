'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { CategoriaDialogo } from './CategoriaDialogo';
import { categoryPathWithQuery } from '@/lib/category-url';
import { cadenaHasta } from '@/lib/category-tree';
import { carryFilters, effectiveTagSlugsFor, filterableAttributeNamesFor } from '@/lib/filter-carry';
import type { Category } from '@/types';

/**
 * A2 — selector de categoría ÚNICO, presente en las dos páginas de resultados.
 *
 * Sustituye a dos controles que hacían cosas distintas con el mismo nombre:
 *  - el "Categoría" de /busqueda, que solo cambiaba el query param `category` y te
 *    dejaba en /busqueda;
 *  - el "Subcategoría" de /[categoria], que sí navegaba, pero solo hacia abajo.
 *
 * Ahora cualquier destino del árbol (y "Todas las categorías") es alcanzable desde
 * cualquiera de las dos páginas, y siempre navegando a la ruta CANÓNICA:
 *
 *   /busqueda?q=x        + Coches  →  /vehiculos/coches?q=x
 *   /vehiculos/coches?q=x + Todas   →  /busqueda?q=x
 *   /vehiculos?…          + Coches  →  /vehiculos/coches?…
 *
 * Los filtros se arrastran, pero SOLO los que valen en el destino: ver lib/filter-carry.ts
 * (el backend responde 400 a un atributo ajeno, así que el filtrado ocurre antes de
 * navegar, no después de romperse).
 *
 * ══ BUSCADOR · BQ-E — Y AHORA ES EL ADAPTADOR QUE NAVEGA ═════════════════════════════
 *
 * El `<select>` se fue; el control es el mismo `CategoriaDialogo` que monta el buscador
 * de la portada, con el MISMO molde (`ui/dialogo-filtrable`) debajo. Lo único distinto
 * entre los dos clientes es lo que hace `onElegir`:
 *
 *   · en la portada     → `setCategory(slug)`; navega después, al enviar el formulario;
 *   · aquí              → `goTo(slug)`, o sea `router.push` en el acto.
 *
 * ⚠ **Y ESA DIFERENCIA VIVE ENTERA EN ESTE FICHERO.** El §12.5 del diseño dejó la
 * pregunta abierta —«decidir si el de /busqueda deja de navegar o si el molde admite un
 * modo que navegue»— y la respuesta es que no hacía falta ninguna de las dos: el molde
 * recibe una función y la llama; qué hace esa función no es asunto suyo. `goTo` no se ha
 * tocado una línea al cambiar el control, que es exactamente la prueba de que el molde no
 * llevaba dominio escondido dentro.
 *
 * ── LO QUE EL CAMBIO DE CONTROL SE LLEVA POR DELANTE, Y ES LA GANANCIA ─────────────
 *
 * El `<select>` pintaba una `<option>` por categoría con su ruta entera como etiqueta
 * («Vehículos › Coches › Deportivos»), y con cuatro niveles y un árbol real eso es una
 * lista larga que sólo se recorre a ojo. El diálogo la filtra por el NOMBRE y enseña la
 * ruta al lado (`CategoriaDialogo`), que es el mismo reparto que ya resolvió la portada.
 */
export function CategorySelect({
  categories,
  currentSlug,
  className,
}: {
  /** Árbol completo (`GET /categories`). */
  categories: Category[];
  /** Categoría en la que está el usuario ahora, o null en /busqueda global. */
  currentSlug: string | null;
  /** Geometría del disparador. La decide quien lo monta — ver `DialogoFiltrable`. */
  className?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function goTo(slug: string) {
    const target = slug === '' ? null : findTarget(categories, slug);
    const allowed = filterableAttributeNamesFor(categories, target?.slug ?? null);
    // B3 — los tags tienen su propia regla de validez en el destino (CategoryTag).
    const tagsPermitidos = effectiveTagSlugsFor(categories, target?.slug ?? null);
    const next = carryFilters(searchParams, target, allowed, tagsPermitidos);
    const query = next.toString();

    if (!target) {
      router.push(query ? `/busqueda?${query}` : '/busqueda');
      return;
    }
    router.push(categoryPathWithQuery(target, next));
  }

  /**
   * ⚠ NI UNA LÍNEA DE DOMINIO AQUÍ. El aplanado del árbol, el filtro por nombre, la ruta
   * de ancestros y la cuenta de subcategorías los sabe `CategoriaDialogo`, que es el
   * MISMO adaptador que usa la portada. Este fichero aporta una sola cosa: que elegir
   * navegue.
   *
   * `valor` es el slug actual y `''` significa «todas», exactamente como significaba en
   * el `<option value="">` de antes — de ahí que `goTo('')` siga llevando a /busqueda sin
   * un caso especial nuevo.
   */
  return (
    <CategoriaDialogo
      categories={categories}
      valor={currentSlug ?? ''}
      onElegir={goTo}
      // Lo que decía la primera `<option>` del `<select>` al que sustituye, palabra por
      // palabra: bajo una sección ya titulada «CATEGORÍA», «Categoría» no informaría de
      // nada y «Todas las categorías» sigue diciendo que ahora mismo no hay filtro.
      etiquetaVacio="Todas las categorías"
      className={className}
    />
  );
}

/**
 * PROFUNDIDAD N — RÁFAGA 2. El árbol se ofrece como una lista PLANA con el PATH
 * completo a la vista: «Vehículos › Coches › Deportivos».
 *
 * POR QUÉ ASÍ Y NO CON `<optgroup>` ANIDADOS: el estándar HTML **no permite
 * anidar optgroup**, así que un `<select>` nativo expresa como mucho DOS niveles
 * de agrupación. No es una limitación del componente: con 4 niveles no hay
 * forma de representarlo agrupando.
 *
 * Y por qué path aplanado y no un navegador por niveles (como `StepCategoria`
 * del wizard, que sí lo es): son casos de uso distintos. Publicar es ELEGIR una
 * categoría explorando; filtrar aquí es SALTAR a una que ya conoces, y para eso
 * una lista plana —con toda la profundidad visible de un vistazo— gana a navegar
 * tres niveles.
 *
 * ⚠ BUSCADOR · BQ-A — EL RECORRIDO YA NO VIVE AQUÍ. Era una función privada de
 * este fichero; ahora es `aplanarArbol` en `lib/category-tree.ts`, junto a los
 * otros cuatro recorridos del árbol. Subió porque BQ-B le trajo un segundo
 * consumidor (el diálogo de categoría del buscador de portada) y dos recorridos
 * parecidos acaban diciendo cosas distintas.
 *
 * ⚠ BUSCADOR · BQ-E — Y LA COMPOSICIÓN DE LA ETIQUETA TAMPOCO. Este fichero unía
 * `[...ancestros, nombre]` con ' › ' para escribir cada `<option>`; ahora la ruta
 * la pinta el diálogo en su propia columna —atenuada, al lado del nombre— y el
 * separador es el de `CategoriaDialogo`, que ya era el mismo carácter. Dos
 * constantes que decían lo mismo han pasado a ser una.
 */

/** Localiza la categoría destino en el árbol y devuelve lo que necesita el carry:
 *  su slug, el del padre (para la URL canónica) y su política de tipo (para `condition`).
 *
 *  PROFUNDIDAD N — RÁFAGA 2: la búsqueda es recursiva. `parentSlug` sigue siendo
 *  el del padre INMEDIATO: es lo que `categoryPath()` consume hoy, y las URLs
 *  profundas son RÁFAGA 3. */
function findTarget(tree: Category[], slug: string) {
  const cadena = cadenaHasta(tree, slug);
  if (cadena.length === 0) {
    // Slug fuera del árbol: no debería pasar (las opciones salen del propio árbol).
    // Se navega igual, sin padre — el middleware canonicaliza si hace falta.
    return { slug, parentSlug: null, allowedListingType: undefined };
  }
  const destino = cadena[cadena.length - 1];
  return {
    slug: destino.slug,
    // PROFUNDIDAD N — RÁFAGA 3: la CADENA entera, para que la URL de destino sea
    // la canónica a cualquier profundidad. Antes bastaba el padre inmediato
    // porque no había nada más hondo.
    ancestorSlugs: cadena.slice(0, -1).map((c) => c.slug),
    allowedListingType: destino.allowedListingType,
  };
}
