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
import { CATEGORIAS, NOMBRE_COOKIE, MAX_AGE_SEGUNDOS, VERSION_TEXTO } from './constantes';

const FUENTE_BACKEND = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'api',
  'src',
  'modules',
  'consent',
  'consent.constants.ts',
);

function leerBackend(): string {
  return readFileSync(FUENTE_BACKEND, 'utf8');
}

describe('las constantes del consentimiento coinciden con las del backend', () => {
  it('el fichero del backend existe donde se espera', () => {
    // Si alguien mueve el fichero, este test falla aquí con un mensaje claro en vez de
    // pasar en verde por no encontrar nada que comparar.
    expect(() => leerBackend()).not.toThrow();
  });

  it('la versión del texto es la misma a los dos lados', () => {
    expect(leerBackend()).toContain(`CONSENT_POLICY_VERSION = '${VERSION_TEXTO}'`);
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
