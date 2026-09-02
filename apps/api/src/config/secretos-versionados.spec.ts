import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

/**
 * DESPLIEGUE GRUPO B — HIGIENE DE SECRETOS. **Las barreras.**
 *
 * ── POR QUÉ ESTO ES UN TEST Y NO UNA LÍNEA DE `.gitignore` ────────────────────────────────
 *
 * El `.gitignore` ya se arregló dos veces caso a caso: `.env.test` y `.env.dev.bak` llegaron a
 * versionarse y su regla se escribió DESPUÉS, con el nombre exacto del fichero que se había
 * colado. Ese método deja un hueco por cada nombre que nadie ha imaginado todavía, y el
 * siguiente hueco medido era el peor de todos: `.env.production`. Ver
 * `docs/auditoria-despliegue.md` §3.7.
 *
 * Arreglarlo es una línea (`.env*` con sus excepciones). **Que siga arreglado es esto.** Un
 * patrón de `.gitignore` es exactamente la clase de cosa que alguien reescribe con buena
 * intención —«voy a ser más explícito»— y vuelve a dejar huecos sin que ningún test proteste.
 *
 * ── SE MIDE CON `git check-ignore`, NO SE LEE EL FICHERO ──────────────────────────────────
 *
 * Comprobar que `.gitignore` CONTIENE la cadena `.env*` no prueba nada: el orden de las
 * reglas, las negaciones y los `.gitignore` de subdirectorio deciden el resultado real, y son
 * justo lo que un cambio bienintencionado rompe. Se le pregunta a git, que es quien decide.
 * Es la misma lección del episodio del IPv6: el `connect` no bastaba, había que mandar datos.
 *
 * ── LO QUE ESTE FICHERO NO PRETENDE ──────────────────────────────────────────────────────
 *
 * **No mira el historial.** Los secretos que estuvieron versionados siguen en los commits
 * pasados y de ahí no los saca un test: eso se cierra ROTANDO las claves, que es lo que ya se
 * hizo. Esto cierra el futuro — que no vuelva a colarse ninguno.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

/** ¿Ignoraría git este camino? Se pregunta a git; `status: 0` = sí. */
function estaIgnorado(rutaRelativa: string): boolean {
  const r = spawnSync('git', ['check-ignore', '-q', '--no-index', rutaRelativa], {
    cwd: REPO_ROOT,
  });
  // 0 = ignorado, 1 = no ignorado. Cualquier otro código es un fallo de git y no
  // debe leerse como «no ignorado»: sería un verde falso.
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(
      `git check-ignore falló para "${rutaRelativa}" (status ${r.status}): ${r.stderr?.toString()}`,
    );
  }
  return r.status === 0;
}

/** Los ficheros de entorno que git tiene versionados AHORA MISMO. */
function ficherosEntornoVersionados(): string[] {
  const r = spawnSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ls-files falló: ${r.stderr}`);
  return r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /(^|\/)\.env/.test(l));
}

describe('Higiene de secretos — el .gitignore cubre la CLASE .env*', () => {
  /**
   * BARRERA 1 — NINGÚN FICHERO DE ENTORNO REAL PUEDE VERSIONARSE.
   *
   * La lista incluye a propósito los tres nombres que la enumeración anterior NO cubría
   * (`.env.production`, `.env.dev`, `.env.staging`, medidos como «NOT ignored» el 2026-09-02) y
   * los dos que sí (`.env`, `.env.test`), para que el test documente el antes y el después.
   *
   * MUTACIÓN QUE ESTE TEST MATA: volver a enumerar nombres en vez de cubrir la clase. Con
   * `.env` + `.env.test` + `.env*.local`, las tres primeras filas se caen.
   */
  const DEBEN_IGNORARSE = [
    '.env',
    '.env.local',
    '.env.test',
    '.env.production',
    '.env.dev',
    '.env.staging',
    'apps/api/.env',
    'apps/api/.env.test',
    'apps/api/.env.production',
    'apps/api/.env.dev',
    // El `.bak` de un `.env` conserva los valores reales del fichero del que se copió.
    'apps/api/.env.dev.bak',
    'apps/web/.env',
    'apps/web/.env.local',
    'apps/web/.env.production',
  ];

  it.each(DEBEN_IGNORARSE)('git ignora %s', (ruta) => {
    expect(estaIgnorado(ruta)).toBe(true);
  });

  /**
   * BARRERA 2 — LAS PLANTILLAS SIGUEN VERSIONÁNDOSE.
   *
   * Es la otra mitad, y sin ella la barrera 1 se «aprueba» borrando las plantillas del repo.
   * Los `.example` son la documentación ejecutable de qué variables hace falta definir; que
   * `.env*` los arrastrara sería cambiar una fuga por un agujero de documentación.
   *
   * `.env.production.example` todavía no existe, y entra igualmente: es la plantilla que el
   * primer despliegue va a necesitar, y conviene saber HOY que la excepción la cubrirá.
   */
  const NO_DEBEN_IGNORARSE = [
    '.env.example',
    'apps/api/.env.example',
    'apps/api/.env.test.example',
    'apps/api/.env.production.example',
    'apps/web/.env.example',
  ];

  it.each(NO_DEBEN_IGNORARSE)('git NO ignora la plantilla %s', (ruta) => {
    expect(estaIgnorado(ruta)).toBe(false);
  });

  it('las tres plantillas que existen siguen realmente en el repo', () => {
    expect(ficherosEntornoVersionados().sort()).toEqual([
      'apps/api/.env.example',
      'apps/api/.env.test.example',
      'apps/web/.env.example',
    ]);
  });
});

describe('Higiene de secretos — cero secretos reales en lo versionado', () => {
  /**
   * BARRERA 3 — NINGÚN VALOR REAL EN UN FICHERO QUE SE VERSIONA.
   *
   * ── POR QUÉ LOS PATRONES VAN ANCLADOS AL PREFIJO DEL PROVEEDOR ───────────────────────────
   *
   * La tentación es una regla genérica del tipo «cualquier cadena larga de base64». **Produce
   * falsos positivos y por eso no se usa**: `apps/api/.env.test.example` contiene
   * `REDSYS_SECRET_KEY=Y2lfcmVkc3lzX2R1bW15X2tleV8yMDI2`, que parece un secreto y no lo es —es
   * base64 de `ci_redsys_dummy_key_2026`, un valor ficticio que debe medir EXACTAMENTE 24
   * bytes porque `redsys-easy` lo usa con 3DES, y que está fijado igual en `ci.yml`—. Una
   * barrera que grita donde no debe se acaba desactivando, y entonces no protege de nada.
   *
   * Anclar al prefijo (`sk_test_`, `whsec_`, `re_`…) más una tirada larga de caracteres
   * alfanuméricos SEGUIDOS distingue lo real del placeholder sin ambigüedad: un
   * `sk_test_your_stripe_test_key_here` no tiene 20 alfanuméricos seguidos en ninguna parte;
   * una clave de Stripe de verdad son cien.
   *
   * ── EL HUECO CONOCIDO, DICHO EN VOZ ALTA ────────────────────────────────────────────────
   *
   * Esto NO caza un secreto sin prefijo reconocible (un `JWT_SECRET` de verdad, por ejemplo).
   * Para esos está la segunda comprobación de abajo, por NOMBRE DE CLAVE.
   */
  const PATRONES_DE_SECRETO: Array<[string, RegExp]> = [
    ['clave secreta de Stripe', /sk_(test|live)_[A-Za-z0-9]{20,}/],
    ['clave publicable de Stripe', /pk_(test|live)_[A-Za-z0-9]{20,}/],
    ['secreto de webhook de Stripe', /whsec_[A-Za-z0-9]{20,}/],
    ['clave de API de Resend', /re_[A-Za-z0-9]{20,}/],
    ['clave de API de Google', /AIza[A-Za-z0-9_-]{30,}/],
    ['DSN de Sentry con proyecto real', /https:\/\/[A-Za-z0-9]{16,}@[\w.-]+\.sentry\.io/],
  ];

  const ficheros = ficherosEntornoVersionados();

  it('hay ficheros de entorno versionados que revisar (si no, el barrido sería vacío)', () => {
    expect(ficheros.length).toBeGreaterThan(0);
  });

  describe.each(ficheros)('%s', (fichero) => {
    const contenido = readFileSync(join(REPO_ROOT, fichero), 'utf8');

    it.each(PATRONES_DE_SECRETO)('no contiene una %s', (_nombre, patron) => {
      const encontrado = contenido.match(patron);
      // El mensaje NO imprime el valor: un test que filtra el secreto en el log del CI
      // sería el mismo problema con otro nombre. Se dice la línea y basta.
      const linea = encontrado
        ? contenido.slice(0, encontrado.index).split('\n').length
        : 0;
      expect(encontrado ? `línea ${linea}` : null).toBeNull();
    });

    /**
     * Las claves que guardan un secreto SIN prefijo reconocible. Su valor debe estar vacío o
     * llevar una marca de plantilla; cualquier otra cosa es sospechosa por definición.
     */
    const CLAVES_SIN_PREFIJO = [
      'JWT_SECRET',
      'CONTACT_FORM_SECRET',
      'REVALIDATE_SECRET',
      'MEILI_MASTER_KEY',
      'AUTH_SECRET',
      'AUTH_GOOGLE_SECRET',
      'S3_SECRET_ACCESS_KEY',
      'REDSYS_SECRET_KEY',
      'DATABASE_URL',
    ];

    const MARCAS_DE_PLANTILLA =
      /change_me|your_|_here|dummy|example|placeholder|minioadmin|localhost|127\.0\.0\.1|marketplace_dev|test/i;

    /**
     * La única excepción, con nombre y motivo. NO es «una cadena rara permitida»: es un valor
     * ficticio cuyo contenido está fijado por una restricción técnica (24 bytes para 3DES) y
     * duplicado a propósito en `ci.yml`. Si alguien lo cambia, este test falla y le obliga a
     * mirar las dos copias — que es exactamente lo que se quiere.
     */
    const EXCEPCIONES: Record<string, string> = {
      // base64 de "ci_redsys_dummy_key_2026" — ver la cabecera de apps/api/.env.test.example.
      REDSYS_SECRET_KEY: 'Y2lfcmVkc3lzX2R1bW15X2tleV8yMDI2',
    };

    it.each(CLAVES_SIN_PREFIJO)('%s no lleva un valor real', (clave) => {
      const m = contenido.match(new RegExp(`^${clave}\\s*=\\s*(.*)$`, 'm'));
      if (!m) return; // la clave no está en este fichero: nada que revisar

      const valor = m[1].trim().replace(/^["']|["']$/g, '').split('#')[0].trim();
      if (valor === '') return;
      if (EXCEPCIONES[clave] === valor) return;

      expect({ clave, pareceReal: !MARCAS_DE_PLANTILLA.test(valor) }).toEqual({
        clave,
        pareceReal: false,
      });
    });
  });
});
