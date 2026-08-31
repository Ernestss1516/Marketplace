import { GRUPOS, SETTING_DESCRIPTIONS, SETTING_TITLES } from './ajustes-organizacion';

/**
 * AJUSTES RÁFAGA A — QUE NINGÚN AJUSTE VUELVA A QUEDARSE MUDO NI HUÉRFANO.
 *
 * ── EL DEFECTO QUE ESTO CIERRA ───────────────────────────────────────────────
 *
 * `/admin/ajustes` llegó a tener DOS ajustes muertos y CUATRO descripciones que decían cosas
 * que el código no hacía, y nada podía notarlo: no había una sola prueba mirando esta pantalla
 * como pantalla. Lo que un test SÍ puede vigilar es la mecánica —que cada ajuste tenga grupo,
 * título y descripción—; que la descripción diga la verdad lo vigilan las barreras del backend
 * (`ajustes-rafaga-a.e2e-spec.ts`) y quien la escriba leyendo el lector.
 *
 * ── LA MUTACIÓN QUE ESTO MATA ────────────────────────────────────────────────
 *
 * Añadir una clave a un grupo y olvidar su descripción. La página pinta entonces una tarjeta
 * con su control y un párrafo VACÍO — un ajuste sin explicación, que es la mitad del defecto
 * que la ráfaga A vino a arreglar. Pasa exactamente igual con el título, y en ese caso la
 * tarjeta se titula con la clave cruda (`fiscalSelfServiceWindow`).
 */
describe('La organización de /admin/ajustes', () => {
  const clavesEnGrupos = GRUPOS.flatMap((g) => g.keys);

  it('cada ajuste de un grupo tiene TÍTULO', () => {
    const sinTitulo = clavesEnGrupos.filter((k) => !SETTING_TITLES[k]);
    expect(sinTitulo).toEqual([]);
  });

  it('cada ajuste de un grupo tiene DESCRIPCIÓN, y no una vacía', () => {
    const sinDescripcion = clavesEnGrupos.filter(
      (k) => !SETTING_DESCRIPTIONS[k] || SETTING_DESCRIPTIONS[k].trim().length === 0,
    );
    expect(sinDescripcion).toEqual([]);
  });

  it('ningún título ni descripción sobra: todos corresponden a un ajuste que se pinta', () => {
    // Al revés que los dos de arriba, y por un motivo distinto: una entrada huérfana no rompe
    // nada visible, pero es la señal de que un ajuste se quitó de la página a medias. La
    // siguiente persona que lo lea creerá que sigue ahí.
    const enGrupos = new Set<string>(clavesEnGrupos);
    expect(Object.keys(SETTING_TITLES).filter((k) => !enGrupos.has(k))).toEqual([]);
    expect(Object.keys(SETTING_DESCRIPTIONS).filter((k) => !enGrupos.has(k))).toEqual([]);
  });

  it('ningún ajuste está en dos grupos a la vez', () => {
    const vistas = new Set<string>();
    const repetidas = clavesEnGrupos.filter((k) => (vistas.has(k) ? true : (vistas.add(k), false)));
    expect(repetidas).toEqual([]);
  });

  it('cada grupo tiene id único, título, resumen y al menos un ajuste', () => {
    expect(new Set(GRUPOS.map((g) => g.id)).size).toBe(GRUPOS.length);
    for (const g of GRUPOS) {
      expect(g.titulo.trim().length).toBeGreaterThan(0);
      expect(g.resumen.trim().length).toBeGreaterThan(0);
      expect(g.keys.length).toBeGreaterThan(0);
    }
  });

  /**
   * LOS DOS QUE ESTUVIERON MUERTOS, nombrados uno a uno.
   *
   * No es una comprobación redundante con las de arriba: es la que dice POR QUÉ están aquí.
   * Si alguien vuelve a quitarlos de la página, que sea una decisión y no un descuido — y
   * quitar el ajuste sin quitar su lector (o al revés) es la forma exacta en que nacieron
   * muertos la primera vez.
   */
  it('los dos ajustes que estuvieron muertos siguen en la página, con su explicación', () => {
    for (const clave of ['listingExpiryDays', 'contactRequiresVerification']) {
      expect(clavesEnGrupos).toContain(clave);
      expect(SETTING_DESCRIPTIONS[clave]).toBeTruthy();
    }
    // La de caducidad tiene que seguir avisando de que NO es retroactiva: es lo que separa
    // «cambio el número» de «muevo la fecha de caducidad de los anuncios de otros».
    expect(SETTING_DESCRIPTIONS.listingExpiryDays).toMatch(/NO ES RETROACTIVO/);
  });

  /**
   * LAS CUATRO DESCRIPCIONES QUE MENTÍAN, pinzadas por lo que decían de más.
   *
   * Las dos de límites de activos afirmaban que «los anuncios más antiguos pasan a borrador al
   * publicar uno nuevo». La regla BLOQUEA (`active-listing-limit.rule.ts`); el paso-a-borrador
   * existe, pero en la degradación Pro→Free y sólo con el límite de Free. La de detectores
   * decía «dos cosas» y son tres.
   */
  it('las descripciones corregidas no vuelven a la versión que mentía', () => {
    for (const clave of ['freeActiveListingLimit', 'proActiveListingLimit']) {
      expect(SETTING_DESCRIPTIONS[clave]).not.toMatch(/más antiguos pasan a borrador al publicar/);
      expect(SETTING_DESCRIPTIONS[clave]).toMatch(/RECHAZA|rechaza/);
    }
    expect(SETTING_DESCRIPTIONS.detectionModes).toMatch(/TRES cosas/);
  });
});
