// PUNTO 6 · RÁFAGA C — LA BARRERA DEL AVISO: el admin se entera ANTES que la cola.
//
// El arreglo del emparejamiento endurece un detector que está en modo BLOQUEAR, y desde la
// ráfaga B bloquear actúa también al editar. Entradas inertes desde hace meses empiezan hoy
// a mandar anuncios a revisión, incluidos anuncios YA PUBLICADOS que su dueño toque.
//
// Este módulo decide a cuáles hay que señalar. Se prueba aparte de la pantalla porque es una
// regla, no un pintado: montar la página de ajustes con sesión y fetch para comprobar una
// condición sobre cadenas costaría más que el cuerpo entero. Molde de `filtros-url.test.ts`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entradasQueEmpiezanAFiltrar, eraInerte, esTelefonoEs } from './entradas-inertes';

describe('qué entradas NO casaban con el emparejamiento viejo', () => {
  it.each([
    ['dinero facil', 'un espacio'],
    ['100%-garantizado', 'un símbolo y un guion'],
    ['192.168.1.1', 'puntos'],
    ['sin  blanquear', 'espacios de más'],
    ['a+b', 'un signo'],
  ])('«%s» era inerte (%s la partía)', (entrada) => {
    expect(eraInerte(entrada)).toBe(true);
  });

  it.each([
    ['estafa', 'una palabra suelta'],
    ['spam2024', 'letras y números, sin separadores'],
    ['estáfa', 'con tilde — la normalización la quita, así que sí casaba'],
    ['ESTAFA', 'en mayúsculas — se normaliza igual'],
  ])('«%s» SÍ funcionaba (%s)', (entrada) => {
    expect(eraInerte(entrada)).toBe(false);
  });

  it('una entrada vacía no es «inerte»: es que no hay entrada', () => {
    // Avisar de una línea en blanco sería ruido, y además la lista las filtra al guardar.
    expect(eraInerte('')).toBe(false);
    expect(eraInerte('   ')).toBe(false);
  });
});

describe('la lista que se le enseña al admin', () => {
  it('sólo trae las que empiezan a filtrar, en el orden en que las escribió', () => {
    expect(
      entradasQueEmpiezanAFiltrar(['estafa', 'dinero facil', 'spam', '100%-garantizado']),
    ).toEqual(['dinero facil', '100%-garantizado']);
  });

  it('una lista que ya estaba bien no produce ningún aviso', () => {
    // Es lo importante para quien no tenía el problema: no se le enseña una alarma por nada.
    expect(entradasQueEmpiezanAFiltrar(['estafa', 'spam'])).toEqual([]);
  });

  it('una lista vacía tampoco', () => {
    expect(entradasQueEmpiezanAFiltrar([])).toEqual([]);
  });
});

describe('LA BARRERA — la pantalla pinta el aviso de verdad', () => {
  // Se lee el fuente por el mismo motivo que en `ValoracionFila.test.tsx`: montar la página
  // de ajustes cuesta más que lo que prueba. Lo que fija es exacto — que el editor de la
  // lista de palabras USA esta regla y tiene dónde pintarla. Sin esto, el módulo podría
  // quedarse escrito, probado y sin llamar por nadie, que es la peor forma de fallar: verde
  // y sin efecto.
  const AJUSTES = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

  it('el editor importa la regla y la usa', () => {
    expect(AJUSTES).toContain("from './entradas-inertes'");
    expect(AJUSTES).toContain('entradasQueEmpiezanAFiltrar(');
  });

  it('y hay un aviso que pintar con ellas', () => {
    expect(AJUSTES).toContain('aviso-entradas-inertes');
  });

  it('la pantalla se lee (red del propio test)', () => {
    expect(AJUSTES.length).toBeGreaterThan(1000);
  });
});

// ─── A2 — los teléfonos que no marcarán nunca ─────────────────────────────────

describe('qué entradas de `flaggedPhones` no casan nunca', () => {
  it.each([
    ['654123456', 'móvil, ya canónico'],
    ['654 123 456', 'con espacios'],
    ['654-12-34-56', 'con guiones'],
    ['+34 654 123 456', 'con prefijo'],
    ['0034654123456', 'con 00 34'],
    ['912345678', 'un fijo'],
  ])('«%s» (%s) SÍ es un teléfono español', (entrada) => {
    expect(esTelefonoEs(entrada)).toBe(true);
  });

  it.each([
    ['12345', 'demasiado corto'],
    ['123456789', 'no empieza por 6-9'],
    ['65412345678', 'demasiado largo'],
    ['no soy un teléfono', 'sin dígitos'],
    ['+44 20 7946 0958', 'de otro país'],
    ['', 'vacío'],
  ])('«%s» (%s) NO lo es, y la pantalla lo marca', (entrada) => {
    // Se guarda igual —para que quien la escribió la reconozca y la corrija— pero no filtra
    // nada. Sin el aviso se quedaría ahí para siempre pareciendo que vigila algo.
    expect(esTelefonoEs(entrada)).toBe(false);
  });

  it('LA BARRERA: la pantalla usa la regla y tiene dónde pintarla', () => {
    // Mismo motivo que en las palabras: el módulo podría quedarse escrito, probado y sin
    // llamar por nadie, que es la peor forma de fallar — verde y sin efecto.
    const AJUSTES = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    expect(AJUSTES).toContain('esTelefonoEs(');
    expect(AJUSTES).toContain('aviso-telefonos-invalidos');
  });
});
