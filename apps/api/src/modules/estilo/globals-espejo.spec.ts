import * as fs from 'fs';
import * as path from 'path';
import { MODELO_0 } from './estilo.constants';

/**
 * E4b — EL REGISTRO Y `globals.css` NO PUEDEN DIVERGIR.
 *
 * ── POR QUÉ EXISTEN LOS DOS ───────────────────────────────────────────────────────
 *
 * El registro del Modelo 0 (aquí, en el backend) es lo que se sirve por `GET /estilo`
 * y lo que el layout raíz escribe en el `<style>`. `globals.css` declara los mismos
 * valores y es **el respaldo**: si el backend no responde, no se emite bloque y manda
 * el CSS, con lo que la plataforma se ve como siempre en vez de sin tema.
 *
 * Ese respaldo es lo que evita duplicar la paleta en el frontend con un mapa de
 * reserva… a cambio de que los dos ficheros digan lo mismo. Y ahí está el riesgo: si
 * divergen, la plataforma se ve **de una manera con el backend en pie y de otra sin
 * él**, que es la clase de fallo que aparece justo el día que algo va mal y nadie
 * relaciona una cosa con la otra.
 *
 * ── POR QUÉ ESTE TEST CRUZA LA FRONTERA ENTRE APPS ───────────────────────────────
 *
 * Lee un fichero de `apps/web` desde `apps/api`, cosa que el código de producción no
 * hace ni debe. Un TEST sí puede: es un monorepo, los dos ficheros se despliegan
 * juntos, y la alternativa —confiar en que nadie olvide actualizar el segundo— es
 * exactamente lo que esta suite existe para no tener que hacer.
 */

const GLOBALS = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'web',
  'src',
  'app',
  'globals.css',
);

describe('El Modelo 0 y globals.css declaran los mismos valores', () => {
  const css = fs.readFileSync(GLOBALS, 'utf8');

  /** Lee `--token: valor;` de la hoja. */
  function enGlobals(token: string): string | null {
    const m = css.match(new RegExp(`--${token}:\\s*([^;]+);`));
    return m ? m[1].trim() : null;
  }

  it('el fichero de respaldo existe donde se espera', () => {
    expect(css.length).toBeGreaterThan(0);
  });

  // Los semánticos y los ejes son los que el modelo declara como literales; la rampa
  // y los cuatro colores se comprueban en `estilo.spec.ts`, que los resuelve.
  const declarados = { ...MODELO_0.semanticos, ...MODELO_0.ejes };

  for (const [token, valor] of Object.entries(declarados)) {
    // `radius` y las familias tipográficas viven en globals.css con el mismo nombre;
    // si alguno dejara de estar, el `toBe` lo dice con el nombre delante.
    it(`--${token}`, () => {
      expect(enGlobals(token)).toBe(valor);
    });
  }

  /**
   * Y al revés: que `globals.css` no declare un semántico que el modelo desconoce.
   * Sin esto, un token añadido sólo al CSS funcionaría con el backend caído y
   * desaparecería con el backend en pie — el fallo más desconcertante posible.
   */
  it('globals.css no declara semánticos que el modelo no conozca', () => {
    const enCss = [...css.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]);
    const intenciones = /^(warning|success|info|pending|neutral|rating|featured|favorite|destructive)(-|$)/;
    const huerfanos = enCss.filter(
      (t) =>
        intenciones.test(t) &&
        !(t in declarados) &&
        // Estos dos los define shadcn y el modelo los resuelve por otra vía.
        !['destructive', 'destructive-foreground'].includes(t),
    );
    expect(huerfanos).toEqual([]);
  });
});
