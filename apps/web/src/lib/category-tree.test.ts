import {
  aplanarArbol,
  buscarEnArbol,
  cadenaHasta,
  conDescendientes,
  recorrerArbol,
  type CategoryNamedNode,
} from './category-tree';

/**
 * ══ BUSCADOR · BQ-A — LOS RECORRIDOS DEL ÁRBOL, POR FIN CON RED ══════════════════════
 *
 * `category-tree.ts` existe desde PROFUNDIDAD N · RÁFAGA 3 y **no tenía ni un test**. Es
 * el sitio del frontend por el que pasan la URL canónica, la miga, el mapa de atributos de
 * tarjeta, los tags efectivos, el sitemap y el selector de categoría: un fallo aquí no da
 * error, **hace desaparecer en silencio una categoría profunda** de seis sitios a la vez.
 * Eso es exactamente lo que el fichero dice que vino a evitar, y era lo que no vigilaba
 * nadie.
 *
 * Entra ahora, en la ráfaga que **añade** `aplanarArbol` y antes de que BQ-B lo consuma,
 * porque una red puesta después del cambio sólo certifica lo que ya hay
 * (`docs/diseno-escaparate.md` §0.2).
 *
 * ── EL ÁRBOL DE PRUEBA LLEGA A CUATRO NIVELES A PROPÓSITO ───────────────────────────
 *
 * `CATEGORY_MAX_DEPTH` vale 4 (`apps/api/src/modules/categories/category.types.ts`), y
 * con dos niveles estas pruebas pasarían por casualidad: la forma vieja de cada recorrido
 * —«las raíces y un nivel de hijas»— también las habría superado. Los bisnietos son la
 * única parte del árbol que distingue un recorrido de verdad de un doble bucle.
 */
const ARBOL: CategoryNamedNode[] = [
  {
    slug: 'vehiculos',
    name: 'Vehículos',
    children: [
      {
        slug: 'coches',
        name: 'Coches',
        children: [
          {
            slug: 'deportivos',
            name: 'Deportivos',
            children: [{ slug: 'clasicos', name: 'Clásicos' }],
          },
        ],
      },
      { slug: 'motos', name: 'Motos' },
    ],
  },
  // Sin `children` en absoluto, no con `children: []`: la API lo OMITE en las hojas y
  // todos los recorridos declaran aceptarlo (`?? []`). Si alguno dejara de hacerlo, se
  // rompería aquí y no en producción.
  { slug: 'inmobiliaria', name: 'Inmobiliaria' },
];

describe('recorrerArbol', () => {
  it('devuelve TODOS los nodos, padres antes que hijos y rama a rama', () => {
    expect(recorrerArbol(ARBOL).map((n) => n.slug)).toEqual([
      'vehiculos',
      'coches',
      'deportivos',
      'clasicos',
      'motos',
      'inmobiliaria',
    ]);
  });
});

describe('buscarEnArbol', () => {
  it('encuentra un bisnieto — el nivel que un doble bucle no ve', () => {
    expect(buscarEnArbol(ARBOL, 'clasicos')?.name).toBe('Clásicos');
  });

  it('devuelve undefined si el slug no está, en vez de inventar un nodo', () => {
    expect(buscarEnArbol(ARBOL, 'no-existe')).toBeUndefined();
  });
});

describe('cadenaHasta', () => {
  it('da la cadena raíz→nodo completa, de la que salen la URL y la miga', () => {
    expect(cadenaHasta(ARBOL, 'clasicos').map((n) => n.slug)).toEqual([
      'vehiculos',
      'coches',
      'deportivos',
      'clasicos',
    ]);
  });

  it('una raíz es una cadena de un solo elemento, no una cadena vacía', () => {
    expect(cadenaHasta(ARBOL, 'inmobiliaria').map((n) => n.slug)).toEqual(['inmobiliaria']);
  });

  it('devuelve [] —y no una cadena a medias— si el slug no está', () => {
    expect(cadenaHasta(ARBOL, 'no-existe')).toEqual([]);
  });
});

describe('conDescendientes', () => {
  it('incluye al nodo y a toda su descendencia, no sólo a sus hijas', () => {
    expect(conDescendientes(ARBOL, 'vehiculos').map((n) => n.slug)).toEqual([
      'vehiculos',
      'coches',
      'deportivos',
      'clasicos',
      'motos',
    ]);
  });

  it('una hoja se devuelve a sí misma', () => {
    expect(conDescendientes(ARBOL, 'clasicos').map((n) => n.slug)).toEqual(['clasicos']);
  });
});

/**
 * ── `aplanarArbol`: lo que BQ-B va a consumir ───────────────────────────────────────
 *
 * Los tres campos van separados porque el diálogo de categoría pinta el nombre y la ruta
 * en columnas distintas y **filtra sólo por el nombre** (`docs/diseno-buscador.md` §3.3).
 * Estas pruebas fijan esa separación: si alguien volviera a devolver la etiqueta ya
 * compuesta, el filtro del diálogo pasaría a buscar en la ruta y «veh» devolvería la rama
 * entera de Vehículos.
 */
describe('aplanarArbol', () => {
  it('aplana los CUATRO niveles en orden de árbol', () => {
    expect(aplanarArbol(ARBOL).map((f) => f.slug)).toEqual([
      'vehiculos',
      'coches',
      'deportivos',
      'clasicos',
      'motos',
      'inmobiliaria',
    ]);
  });

  it('separa el nombre propio de la cadena de ancestros', () => {
    const clasicos = aplanarArbol(ARBOL).find((f) => f.slug === 'clasicos');
    expect(clasicos).toMatchObject({
      nombre: 'Clásicos',
      ancestros: ['Vehículos', 'Coches', 'Deportivos'],
    });
  });

  it('una raíz no tiene ancestros', () => {
    const raiz = aplanarArbol(ARBOL).find((f) => f.slug === 'vehiculos');
    expect(raiz?.ancestros).toEqual([]);
  });

  it('cuenta la descendencia ENTERA, no las hijas directas', () => {
    const porSlug = Object.fromEntries(aplanarArbol(ARBOL).map((f) => [f.slug, f.nDescendientes]));
    // Vehículos tiene 2 hijas (Coches, Motos) pero CUATRO descendientes.
    expect(porSlug.vehiculos).toBe(4);
    expect(porSlug.coches).toBe(2);
    expect(porSlug.deportivos).toBe(1);
    expect(porSlug.clasicos).toBe(0);
    expect(porSlug.inmobiliaria).toBe(0);
  });

  /**
   * LA GARANTÍA DE «CAMBIO VISUAL NULO» DE BQ-A, ESCRITA COMO PRUEBA.
   *
   * `CategorySelect` componía su etiqueta con una función privada suya y ahora la compone
   * con ésta. **El `<select>` de /busqueda tiene que seguir diciendo exactamente lo
   * mismo**, o BQ-A habría cambiado de aspecto una pantalla que no toca. Se fija aquí, y
   * no en el componente, porque lo que hay que congelar es la CADENA, no el marcado.
   */
  it('compuesta con « › » da la etiqueta que el <select> de /busqueda ya mostraba', () => {
    const etiquetas = aplanarArbol(ARBOL).map((f) => [...f.ancestros, f.nombre].join(' › '));
    expect(etiquetas).toEqual([
      'Vehículos',
      'Vehículos › Coches',
      'Vehículos › Coches › Deportivos',
      'Vehículos › Coches › Deportivos › Clásicos',
      'Vehículos › Motos',
      'Inmobiliaria',
    ]);
  });

  it('un árbol vacío da una lista vacía, no revienta', () => {
    expect(aplanarArbol([])).toEqual([]);
  });
});
