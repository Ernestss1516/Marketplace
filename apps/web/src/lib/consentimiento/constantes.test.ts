/**
 * COOKIES RÁFAGA 1 — LOS DOS LADOS NO PUEDEN DIVERGIR.
 *
 * No hay paquete compartido en este monorepo (sólo `apps/web` y `apps/api`), así que las
 * constantes del consentimiento están duplicadas a propósito en
 * `apps/api/src/modules/consent/consent.constants.ts`. Este test es lo que hace que esa
 * duplicación sea segura: lee el fichero del backend y compara.
 *
 * POR QUÉ IMPORTA, con el caso concreto: si la versión del texto divergiera, el
 * navegador registraría «consintió la versión 2» mientras el usuario tenía delante la 1
 * (o al revés). La prueba diría algo falso, que es peor que no tener prueba.
 *
 * Y si divergiera el NOMBRE de la cookie, la política de cookies declararía una que no
 * existe — empezar mintiendo justo en el documento que existe para no mentir.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIAS, NOMBRE_COOKIE, MAX_AGE_SEGUNDOS, VERSION_TEXTO_FALLBACK } from './constantes';
import { COOKIE_TEXT_FALLBACK } from './texto-defecto';

const RAIZ_API = join(__dirname, '..', '..', '..', '..', 'api');

const FUENTE_BACKEND = join(RAIZ_API, 'src', 'modules', 'consent', 'consent.constants.ts');
const FUENTE_SEED = join(RAIZ_API, 'prisma', 'seed-settings.ts');

function leerBackend(): string {
  return readFileSync(FUENTE_BACKEND, 'utf8');
}

function leerSeed(): string {
  return readFileSync(FUENTE_SEED, 'utf8');
}

/** Las comillas y los saltos de línea estorban al comparar textos partidos en varias líneas. */
function normalizar(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

describe('las constantes del consentimiento coinciden con las del backend', () => {
  it('el fichero del backend existe donde se espera', () => {
    // Si alguien mueve el fichero, este test falla aquí con un mensaje claro en vez de
    // pasar en verde por no encontrar nada que comparar.
    expect(() => leerBackend()).not.toThrow();
  });

  it('la versión del texto es la misma a los dos lados', () => {
    expect(leerBackend()).toContain(`CONSENT_POLICY_VERSION = '${VERSION_TEXTO_FALLBACK}'`);
  });

  it('el nombre de la cookie es el mismo a los dos lados', () => {
    expect(leerBackend()).toContain(`CONSENT_COOKIE_NAME = '${NOMBRE_COOKIE}'`);
  });

  it('las categorías son las mismas a los dos lados', () => {
    const fuente = leerBackend();
    for (const categoria of CATEGORIAS) {
      expect(fuente).toContain(`'${categoria}'`);
    }
    // Y ninguna de más: el backend valida contra su propia lista, así que una categoría
    // que sólo existiera allí sería aceptable por la API e invisible para el gate.
    const declaradas = /CONSENT_CATEGORIES = \[([^\]]*)\]/.exec(fuente)?.[1] ?? '';
    const cuantas = declaradas.split(',').filter((t) => t.trim().length > 0).length;
    expect(cuantas).toBe(CATEGORIAS.length);
  });

  it('la duración de la cookie es la misma a los dos lados (D4 — seis meses)', () => {
    expect(leerBackend()).toContain(`CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180`);
    expect(MAX_AGE_SEGUNDOS).toBe(60 * 60 * 24 * 180);
  });
});

describe('las categorías son sólo las que corresponden a cookies reales', () => {
  it('existe «terceros» y NO existen «analítica», «marketing» ni «preferencias»', () => {
    // No es una comprobación decorativa: es la que impide que el banner de la ráfaga 2
    // ofrezca apagar algo que no existe. La telemetría propia no toca el terminal (D1);
    // no hay un solo tercero publicitario; no hay cookie de tema ni de idioma.
    expect([...CATEGORIAS]).toEqual(['terceros']);
  });
});

/**
 * RÁFAGA 2 — EL TEXTO POR DEFECTO DEL BANNER VIVE EN TRES SITIOS.
 *
 * `COOKIE_TEXT_DEFAULTS` (el respaldo del backend), `SEED_SETTINGS` (lo que se siembra) y
 * `COOKIE_TEXT_FALLBACK` (el respaldo del frontend, para cuando la API no responde). Los
 * tres tienen razón de ser y ninguno sobra:
 *
 *  · sin el del backend, a una instancia sin filas se le queda el banner vacío;
 *  · sin la semilla, el texto no es editable desde el backoffice (la lección de
 *    `videoEnabled`: lo que no está sembrado no existe en producción);
 *  · sin el del frontend, un backend caído deja la plataforma SIN banner legal.
 *
 * Lo que no puede pasar es que digan cosas distintas: el usuario vería un texto, la
 * semilla otro y el respaldo un tercero, según qué se hubiera caído ese día. Estos casos
 * son la red — y se escribieron porque los comentarios de los tres ficheros ya afirmaban
 * que existía.
 */
describe('el texto por defecto del banner es el MISMO en los tres sitios', () => {
  const CAMPOS = [
    ['title', 'cookieBannerTitle'],
    ['acceptLabel', 'cookieBannerAcceptLabel'],
    ['rejectLabel', 'cookieBannerRejectLabel'],
    ['moreLabel', 'cookieBannerMoreLabel'],
  ] as const;

  it.each(CAMPOS)('«%s» coincide con el respaldo del backend', (campo) => {
    const valor = COOKIE_TEXT_FALLBACK[campo];
    expect(normalizar(leerBackend())).toContain(`${campo}: '${valor}'`);
  });

  it.each(CAMPOS)('«%s» coincide con lo que siembra la semilla (%s)', (campo, clave) => {
    const valor = COOKIE_TEXT_FALLBACK[campo];
    expect(normalizar(leerSeed())).toContain(`key: '${clave}', value: '${valor}'`);
  });

  it('el cuerpo del mensaje es el mismo en los tres', () => {
    // Va aparte porque está partido en varias líneas en los tres ficheros: se compara
    // sobre el texto normalizado, sin los cortes ni las comillas de concatenación.
    const cuerpo = COOKIE_TEXT_FALLBACK.body;
    const trozo = cuerpo.slice(0, 60);
    const sinComillas = (s: string) => normalizar(s).replace(/' \+ '/g, '');

    expect(sinComillas(leerBackend())).toContain(trozo);
    expect(sinComillas(leerSeed())).toContain(trozo);
    // Y el final, para que no valga con que coincida el principio.
    expect(sinComillas(leerBackend())).toContain(cuerpo.slice(-50));
    expect(sinComillas(leerSeed())).toContain(cuerpo.slice(-50));
  });

  it('la versión del respaldo del frontend es la que siembra la semilla', () => {
    // Si divergieran, el banner compararía contra una versión que nadie publicó y
    // volvería a preguntar a todo el mundo sin que nadie hubiera cambiado el texto.
    expect(normalizar(leerSeed())).toContain(
      `key: 'cookiePolicyVersion', value: '${COOKIE_TEXT_FALLBACK.version}'`,
    );
    expect(COOKIE_TEXT_FALLBACK.version).toBe(VERSION_TEXTO_FALLBACK);
  });
});
