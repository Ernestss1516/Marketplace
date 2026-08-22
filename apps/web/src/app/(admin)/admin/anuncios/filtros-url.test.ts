/**
 * FICHA F2 — la traducción URL ↔ filtros, pinzada.
 *
 * Se prueba aquí y no en el navegador porque es una función pura con reglas
 * —qué se omite, qué se normaliza, cuándo se vuelve a la página 1— y montarla
 * en Playwright sólo lo haría más lento sin comprobar más. Molde:
 * `moderacion-routing.test.ts`.
 *
 * La regla que más importa: **lo que está por defecto NO se escribe**. Sin ella,
 * `/admin/anuncios` recién abierto sería un churro de parámetros vacíos y la URL
 * dejaría de servir para lo único que justifica meter ahí los filtros: poder
 * compartirla.
 */

import { aQueryString, conFiltro, hayFiltros, leerFiltros } from './filtros-url';

describe('leerFiltros', () => {
  const leer = (qs: string) => leerFiltros(new URLSearchParams(qs));

  it('una URL vacía no produce ningún filtro (y la página es la 1)', () => {
    expect(leer('')).toEqual({
      q: undefined,
      statuses: undefined,
      categoryId: undefined,
      sellerId: undefined,
      hasReports: undefined,
      needsRevalidation: undefined,
      triage: undefined,
      watched: undefined,
      createdFrom: undefined,
      createdTo: undefined,
      order: undefined,
      page: 1,
    });
  });

  it('parte `triage` por comas, igual que `statuses`', () => {
    // ETIQUETA INTERNA (P1, E2) — el eje nuevo entra con la MISMA forma que los
    // de F2. Que no haya tenido que inventarse otra es lo que quería decir
    // «ampliable sin rediseño».
    expect(leer('triage=EDITED,NEW').triage).toEqual(['EDITED', 'NEW']);
  });

  it('`watched` distingue las tres posiciones', () => {
    expect(leer('watched=true').watched).toBe(true);
    expect(leer('watched=false').watched).toBe(false);
    expect(leer('').watched).toBeUndefined();
  });

  it('parte `statuses` por comas', () => {
    expect(leer('statuses=DRAFT,PENDING_REVIEW').statuses).toEqual(['DRAFT', 'PENDING_REVIEW']);
  });

  it('distingue las TRES posiciones de un booleano', () => {
    // «Sin denuncias» es una pregunta útil y distinta de «me da igual»; si el
    // ausente se colapsara en `false`, la lista se abriría ya filtrada.
    expect(leer('hasReports=true').hasReports).toBe(true);
    expect(leer('hasReports=false').hasReports).toBe(false);
    expect(leer('').hasReports).toBeUndefined();
    expect(leer('hasReports=cualquiercosa').hasReports).toBeUndefined();
  });

  it('ignora un orden desconocido en vez de romper la pantalla', () => {
    // Una URL compartida puede venir de una versión anterior. El coste de un
    // parámetro que sobra es cero; el de una pantalla en blanco, no.
    expect(leer('order=inventado').order).toBeUndefined();
    expect(leer('order=price-asc').order).toBe('price-asc');
  });

  it('una página inválida cae en la 1', () => {
    expect(leer('page=0').page).toBe(1);
    expect(leer('page=-3').page).toBe(1);
    expect(leer('page=abc').page).toBe(1);
    expect(leer('page=4').page).toBe(4);
  });
});

describe('aQueryString', () => {
  it('sin filtros devuelve una cadena VACÍA — la URL limpia de entrada', () => {
    expect(aQueryString({})).toBe('');
  });

  it('omite el orden por defecto y la página 1', () => {
    expect(aQueryString({ order: 'recent', page: 1 })).toBe('');
    expect(aQueryString({ order: 'price-asc' })).toBe('order=price-asc');
    expect(aQueryString({ page: 3 })).toBe('page=3');
  });

  it('recorta el texto y omite el que sólo tiene espacios', () => {
    expect(aQueryString({ q: '  bici  ' })).toBe('q=bici');
    expect(aQueryString({ q: '   ' })).toBe('');
  });

  it('escribe `false` explícitamente (no es lo mismo que no filtrar)', () => {
    expect(aQueryString({ hasReports: false })).toBe('hasReports=false');
  });

  it('ida y vuelta: lo que se escribe se vuelve a leer igual', () => {
    const filtros = {
      q: 'bicicleta',
      statuses: ['DRAFT', 'ARCHIVED'],
      categoryId: 'cat-1',
      sellerId: 'user-1',
      hasReports: true,
      needsRevalidation: false,
      triage: ['EDITED', 'NEW'],
      watched: true,
      createdFrom: '2026-01-01T00:00:00.000Z',
      createdTo: '2026-06-01T00:00:00.000Z',
      order: 'price-desc' as const,
      page: 2,
    };

    expect(leerFiltros(new URLSearchParams(aQueryString(filtros)))).toEqual(filtros);
  });
});

describe('hayFiltros', () => {
  it('la página y el orden NO cuentan como filtro', () => {
    // Ofrecer «Limpiar filtros» por estar en la página 2 sería confuso: ninguno
    // de los dos acota el conjunto, sólo cambian cómo se mira.
    expect(hayFiltros({ page: 5, order: 'price-asc' })).toBe(false);
  });

  it('cualquier eje que acote sí cuenta', () => {
    expect(hayFiltros({ q: 'x' })).toBe(true);
    expect(hayFiltros({ statuses: ['DRAFT'] })).toBe(true);
    expect(hayFiltros({ sellerId: 'u1' })).toBe(true);
    expect(hayFiltros({ hasReports: false })).toBe(true);
    expect(hayFiltros({ triage: ['EDITED'] })).toBe(true);
    expect(hayFiltros({ watched: false })).toBe(true);
  });

  it('un texto de sólo espacios no cuenta', () => {
    expect(hayFiltros({ q: '   ' })).toBe(false);
  });
});

describe('conFiltro', () => {
  it('cambiar cualquier control devuelve a la página 1', () => {
    // Filtrar desde la página 7 de un conjunto que ahora tiene dos deja la
    // pantalla vacía, y eso se lee como «el filtro no ha encontrado nada».
    expect(conFiltro({ page: 7, q: 'a' }, { q: 'b' })).toEqual({ page: 1, q: 'b' });
  });

  it('también al reordenar: se reordena para ver lo que queda ARRIBA', () => {
    expect(conFiltro({ page: 7 }, { order: 'reports-desc' }).page).toBe(1);
  });

  it('conserva los ejes que no se tocan', () => {
    const antes = { q: 'bici', sellerId: 'u1', statuses: ['DRAFT'] };
    expect(conFiltro(antes, { statuses: ['ACTIVE'] })).toEqual({
      q: 'bici',
      sellerId: 'u1',
      statuses: ['ACTIVE'],
      page: 1,
    });
  });
});

// ─── Los tres ejes nuevos: teléfono, provincia y municipio ────────────────────
//
// Entran con la misma forma que los seis anteriores —una clave al leer, una al escribir y
// una línea en `hayFiltros`—, que es lo que F2 prometió que costaría añadir un eje. Van
// SUELTOS y no dentro de `q`: «de Toledo» y «menciona Toledo» son preguntas distintas, y un
// teléfono es un identificador que se busca entero (igual que la IP desde 5b).

describe('teléfono, provincia y municipio en la URL', () => {
  it('se leen los tres', () => {
    const f = leerFiltros(
      new URLSearchParams('phone=654123456&province=Toledo&city=Illescas'),
    );
    expect(f.phone).toBe('654123456');
    expect(f.province).toBe('Toledo');
    expect(f.city).toBe('Illescas');
  });

  it('y se escriben, recortados', () => {
    const qs = aQueryString({ phone: '  654 123 456 ', province: 'Toledo', city: '' });
    const params = new URLSearchParams(qs);
    expect(params.get('phone')).toBe('654 123 456');
    expect(params.get('province')).toBe('Toledo');
    // Vacío es «sin filtro»: no ensucia la URL.
    expect(params.has('city')).toBe(false);
  });

  it('ida y vuelta: lo que se escribe se vuelve a leer igual', () => {
    const original = { phone: '654123456', province: 'Toledo', city: 'Illescas' };
    const vuelta = leerFiltros(new URLSearchParams(aQueryString(original)));
    expect(vuelta).toMatchObject(original);
  });

  it('cualquiera de los tres enciende «Limpiar»', () => {
    expect(hayFiltros({ phone: '654123456' })).toBe(true);
    expect(hayFiltros({ province: 'Toledo' })).toBe(true);
    expect(hayFiltros({ city: 'Illescas' })).toBe(true);
    // Sólo espacios no es un filtro.
    expect(hayFiltros({ city: '   ' })).toBe(false);
  });

  it('una URL sin ellos sigue saliendo limpia', () => {
    expect(aQueryString({})).toBe('');
  });
});
