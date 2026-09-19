import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

/**
 * HIGIENE DE LAS SPECS DE SEGURIDAD — **que el verde signifique algo.**
 *
 * ── EL CASO QUE LO TRAJO ──────────────────────────────────────────────────────────────────
 *
 * `apps/web/e2e/admin-fuga-secretos.spec.ts` comprobaba que una pantalla de staff no pinta el
 * mensaje de error del servidor (donde podría venir una clave dentro). Sus tres aserciones de
 * fondo son negativas —el secreto no está, el texto del servidor no está— y la cuarta era la
 * que garantizaba que había ALGO que escanear:
 *
 *     expect(cuerpo).toContain('500');   // sobre el textContent de la página entera
 *
 * La satisface cualquier `500` del documento: un precio de 500 €, un identificador, un
 * contador. Con ella verde, las tres negativas podían estar mirando una página a medio cargar
 * —donde, naturalmente, tampoco hay ningún secreto—. **Un verde que no significaba «no hay
 * fuga», sino «el observador no miraba».** En una spec de seguridad eso es peor que un rojo
 * falso: el rojo molesta hasta que alguien lo arregla; el verde falso se queda callado.
 *
 * El mismo barrido encontró la forma con el signo cambiado en `admin-roles.spec.ts`: un
 * `not.toContain('forbidden')` escrito contra un molde de error que ya no existe, o sea una
 * aguja que no podía encontrar nada. Las dos son la misma enfermedad —la aguja no describe la
 * propiedad— y las dos acaban en un verde que no prueba nada.
 *
 * ── LA REGLA ──────────────────────────────────────────────────────────────────────────────
 *
 * En una spec de seguridad, una aserción POSITIVA por substring con una aguja corta y sin
 * estructura (`'500'`, `'403'`, `'admin'`) está prohibida: se afirma la PROPIEDAD —la ausencia
 * real del secreto, el estado exacto de la respuesta, el texto completo que sólo el producto
 * puede generar— o se anota por qué esa aguja concreta sólo puede venir de la propiedad.
 *
 * «Corta y sin estructura» es `^[A-Za-z0-9]{0,7}$`: sin `/`, sin `_`, sin `(`, sin `-`, sin
 * espacios. Los caracteres estructurales son justo los que anclan una aguja a su sitio —
 * `'(403)'` sólo lo escribe el molde de error; `'403'` lo escribe cualquier marca de tiempo,
 * y de hecho lo hizo: `PAG-1789844822403` tumbó `admin-roles` una vez de cada cien—.
 *
 * ── LO QUE ESTE TEST NO ES ────────────────────────────────────────────────────────────────
 *
 * No es un analizador de TypeScript: lee texto. Por eso no puede saber si el pajar es grande
 * (la página entera) o pequeño (el `message` de una respuesta), que es lo que de verdad decide
 * si un substring esconde. Prohíbe la FORMA y deja la excepción a mano, con nombre — que es lo
 * que convierte «me acordé de pensarlo» en «está escrito por qué».
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

/**
 * Las specs cuya afirmación es de SEGURIDAD: que un secreto no se filtra, que un rol no puede,
 * que un dato privado no sale. No entran las de cumplimiento por PRESENCIA —la página de
 * cookies tiene que DECIR que usa Vimeo, y ahí el substring positivo es la propiedad, no un
 * atajo—: son otra familia y meterlas sólo generaría excepciones anotadas sin valor.
 *
 * Una spec de seguridad nueva se añade aquí. Si no se añade, no está vigilada — y por eso el
 * test de más abajo exige que las de la lista EXISTAN: un renombrado que vaciara el barrido en
 * silencio sería, otra vez, un verde que no significa nada.
 */
const SPECS_DE_SEGURIDAD = [
  // El secreto no llega al DOM del backoffice.
  'apps/web/e2e/admin-fuga-secretos.spec.ts',
  'apps/web/e2e/admin-instancia.spec.ts',
  'apps/web/e2e/helpers/secretos.ts',
  'apps/web/src/lib/api/__tests__/mensaje-error-admin.test.ts',
  // Quién puede qué.
  'apps/web/e2e/admin-roles.spec.ts',
  'apps/api/src/common/roles/role-hierarchy.spec.ts',
  'apps/api/src/common/roles/admin-controllers.contract.spec.ts',
  'apps/api/src/common/decorators/min-role.decorator.spec.ts',
  'apps/api/test/editor-role.e2e-spec.ts',
  'apps/api/test/usuario-ficha-gate.e2e-spec.ts',
  // Secretos, credenciales y datos privados a nivel HTTP.
  'apps/api/src/config/secretos-versionados.spec.ts',
  'apps/api/test/instance-info.e2e-spec.ts',
  'apps/api/test/auth-security.e2e-spec.ts',
  'apps/api/test/privacidad-payloads.e2e-spec.ts',
  'apps/api/test/tickets-internal-notes.e2e-spec.ts',
  'apps/api/test/cors-http.e2e-spec.ts',
  'apps/api/test/messaging-cors.e2e-spec.ts',
];

/** La marca que permite una aguja corta, OBLIGANDO a escribir el motivo en la misma línea. */
const MARCA_DE_EXCEPCION = 'aguja-segura:';

const ASERCION =
  /(not\s*\.\s*)?(toContain|toContainText|toHaveText)\(\s*(['"`])([^'"`]*)\3/g;

/** Aguja corta y sin un solo carácter que la ancle. */
const AGUJA_GENERICA = /^[A-Za-z0-9]{0,7}$/;

/**
 * Quita los comentarios antes de buscar. Sin esto, la nota que explica el arreglo —«antes
 * ponía `toContain('500')`»— se denunciaría a sí misma, y la única salida sería dejar de
 * contar la historia, que es lo que impide que el error vuelva.
 *
 * El `//` sólo se corta cuando no va detrás de `:`, para no partir un `https://` dentro de una
 * cadena. En el peor caso este recorte hace que el detector MIRE DE MENOS, nunca de más: no
 * puede inventar un hallazgo que no esté.
 */
function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, ' '))
    .split('\n')
    // `[^\n]*` y no `.*$`: en un repo con finales de línea CRLF, `.` no casa el `\r` y `$`
    // (sin bandera `m`) sólo casa al final del texto, así que el comentario se quedaba
    // entero. Costó un rojo del propio detector contra la nota que lo explicaba.
    .map((linea) => linea.replace(/(^|[^:])\/\/[^\n]*/, '$1'))
    .join('\n');
}

interface Hallazgo {
  fichero: string;
  linea: number;
  aguja: string;
  texto: string;
}

function agujasGenericas(fichero: string): Hallazgo[] {
  const bruto = readFileSync(join(REPO_ROOT, fichero), 'utf8');
  const lineasBrutas = bruto.split('\n');
  const hallazgos: Hallazgo[] = [];

  sinComentarios(bruto)
    .split('\n')
    .forEach((linea, i) => {
      ASERCION.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ASERCION.exec(linea))) {
        if (m[1]) continue; // negativa: afirmar la ausencia es la forma fuerte
        if (!AGUJA_GENERICA.test(m[4])) continue;
        // La excepción se lee de la línea ORIGINAL: la marca vive en un comentario.
        if (lineasBrutas[i].includes(MARCA_DE_EXCEPCION)) continue;
        hallazgos.push({
          fichero,
          linea: i + 1,
          aguja: m[4],
          texto: lineasBrutas[i].trim(),
        });
      }
    });

  return hallazgos;
}

describe('Specs de seguridad — ninguna afirma por un substring genérico', () => {
  it('las specs de la lista existen (si no, el barrido sería vacío)', () => {
    const ausentes = SPECS_DE_SEGURIDAD.filter((f) => !existsSync(join(REPO_ROOT, f)));
    expect(ausentes).toEqual([]);
    expect(SPECS_DE_SEGURIDAD.length).toBeGreaterThan(10);
  });

  it.each(SPECS_DE_SEGURIDAD)('%s', (fichero) => {
    const hallazgos = agujasGenericas(fichero);

    // El mensaje dice la línea y qué hacer, porque quien lo lea en CI no va a tener este
    // fichero delante.
    expect(
      hallazgos.map((h) => `línea ${h.linea}: toContain('${h.aguja}') → ${h.texto}`),
    ).toEqual([]);
  });

  /**
   * VALIDACIÓN DEL INSTRUMENTO — el detector cae ante su propio defecto.
   *
   * Un barrido que no encuentra nada y un barrido roto se parecen demasiado. Esto le da de
   * comer la forma exacta que se arregló y exige que la señale.
   */
  it('el detector reconoce la forma prohibida y respeta la negativa y la excepción', () => {
    const casos: Array<[string, boolean]> = [
      [`expect(cuerpo).toContain('500');`, true],
      [`expect(texto).toContain('403');`, true],
      [`await expect(fila).toContainText('admin');`, true],
      // La negativa es la forma fuerte: afirmar la AUSENCIA nunca se prohíbe.
      [`expect(cuerpo).not.toContain('500');`, false],
      // Con estructura, la aguja está anclada y no la satisface un identificador.
      [`expect(texto).not.toContain('(403)');`, false],
      [`expect(page.url()).toContain('/admin/blog');`, false],
      [`expect(salida).toContain('no tienes permiso');`, false],
      // La excepción, con su motivo escrito al lado.
      [`expect(x).toContain('DEV'); // aguja-segura: la fija el proveedor de pega`, false],
    ];

    const detecta = (linea: string) => {
      ASERCION.lastIndex = 0;
      const sinComent = sinComentarios(linea);
      let m: RegExpExecArray | null;
      while ((m = ASERCION.exec(sinComent))) {
        if (m[1]) continue;
        if (!AGUJA_GENERICA.test(m[4])) continue;
        if (linea.includes(MARCA_DE_EXCEPCION)) continue;
        return true;
      }
      return false;
    };

    expect(casos.map(([linea]) => [linea, detecta(linea)])).toEqual(
      casos.map(([linea, esperado]) => [linea, esperado]),
    );
  });
});
