import * as fs from 'fs';
import * as path from 'path';
import { MODELO_0, resolverTokens, validarContraste, type Tokens } from './estilo.constants';

/**
 * E9 — CADA PAREJA BLOQUEANTE TIENE UN CAMPO DONDE PINTARSE.
 *
 * ── QUÉ PROTEGE ──────────────────────────────────────────────────────────────────────
 *
 * El 422 de `PUT /admin/estilo` nombra la pareja que falla en castellano («letra sobre el
 * color principal»), porque describe una MEDICIÓN entre dos tokens derivados. La pantalla
 * `/admin/estilo` tiene cuatro campos y ninguno se llama así, de modo que traduce de una
 * a otro con un mapa —`COLOR_CULPABLE`, en `apps/web/src/lib/api/estilo-admin.ts`— que
 * casa **por texto**.
 *
 * Ahí está el riesgo que este test existe para cerrar: si alguien renombra una pareja
 * aquí, o añade una nueva a `parejasBloqueantes`, el mapa de allí deja de casar **en
 * silencio**. No rompe nada —el fallo cae al bloque de «sin ubicar» y se sigue viendo con
 * su ratio—, pero deja de estar junto al color que hay que corregir, que es justo lo que
 * hacía útil el aviso. Un fallo que no rompe nada es un fallo que nadie descubre.
 *
 * ── POR QUÉ CRUZA LA FRONTERA ENTRE APPS ─────────────────────────────────────────────
 *
 * Mismo argumento, palabra por palabra, que `globals-espejo.spec.ts`: lee un fichero de
 * `apps/web` desde `apps/api`, cosa que el código de producción no hace ni debe. Un TEST
 * sí puede — es un monorepo, los dos ficheros se despliegan juntos, y la alternativa es
 * confiar en que nadie lo olvide.
 *
 * ── POR QUÉ SE LEE EL FICHERO Y NO SE IMPORTA ────────────────────────────────────────
 *
 * `apps/api` no tiene los alias de módulo de `apps/web` (`@/...`), así que importarlo
 * arrastraría su configuración de TypeScript entera dentro de esta suite. Del mapa sólo
 * hacen falta las claves, y para eso basta leer el fichero: es la misma técnica que usa
 * el espejo de `globals.css`.
 */

const ESTILO_ADMIN = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'web',
  'src',
  'lib',
  'api',
  'estilo-admin.ts',
);

/**
 * Las parejas bloqueantes, sacadas del 422 REAL y no de una lista copiada aquí.
 *
 * Se provoca el fallo por la vía de verdad: un tema en el que todo empata a 1:1 —el mismo
 * gris de fondo, de letra y de marca— no puede cumplir NINGUNA pareja, así que
 * `validarContraste` las devuelve todas. Copiar los nombres a mano en este test sería
 * crear una tercera lista que mantener, que es el defecto que el test denuncia.
 */
function todasLasParejasBloqueantes(): string[] {
  const gris = '0 0% 50%';
  const plano = resolverTokens(MODELO_0, {
    primary: gris,
    secondary: gris,
    accent: gris,
    neutral: gris,
  });
  // La rampa deriva luminosidades distintas del neutro, así que se aplastan todas al
  // mismo valor: lo que se busca aquí es el CONJUNTO de parejas, no una medición.
  const aplastado: Tokens = Object.fromEntries(
    Object.keys(plano).map((k) => [k, gris]),
  ) as Tokens;

  const parejas = validarContraste(aplastado).map((f) => f.pareja);
  expect(parejas.length).toBeGreaterThan(0);
  return parejas;
}

describe('el 422 de contraste y la pantalla de admin no pueden divergir', () => {
  const fuente = fs.readFileSync(ESTILO_ADMIN, 'utf8');

  it('el fichero del cliente de admin existe donde se espera (red del propio test)', () => {
    expect(fuente).toContain('COLOR_CULPABLE');
  });

  it.each(todasLasParejasBloqueantes().map((p) => [p]))(
    '«%s» tiene entrada en COLOR_CULPABLE',
    (pareja) => {
      // Si esto se pone en rojo: se ha renombrado o añadido una pareja en
      // `parejasBloqueantes` y hay que darle su campo en `COLOR_CULPABLE` —el color que
      // el admin puede mover para arreglarla—, o el aviso dejará de salir junto a él.
      expect(fuente).toContain(`'${pareja}':`);
    },
  );
});
