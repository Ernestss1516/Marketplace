import { envValidationSchema } from './env.validation';
import { REMITENTE_PLACEHOLDER } from './remitente';

/**
 * DESPLIEGUE GRUPO A — LA VALIDACIÓN DE PRODUCCIÓN, EJERCIDA.
 *
 * ── POR QUÉ SE PRUEBA EL ESQUEMA Y NO EL ARRANQUE ────────────────────────────────────────
 *
 * Lo que se quiere garantizar es «producción no arranca sin esto». Levantar la aplicación de
 * verdad con `NODE_ENV=production` para comprobarlo exigiría una base de datos, un Redis y un
 * Meilisearch de producción falsos, y probaría sobre todo que esas piezas están levantadas.
 * El punto donde se decide es el esquema: `ConfigModule.forRoot({ validationSchema })` aborta
 * el arranque con lo que devuelva esto. Así que se ataca aquí, que es barato y determinista.
 *
 * ── LAS DOS MITADES, Y LA SEGUNDA ES LA QUE SE OLVIDA ────────────────────────────────────
 *
 * Media suite comprueba que producción SE NIEGA a arrancar sin lo esencial. La otra media
 * comprueba que **`development` y `test` siguen exactamente igual** — sin ella, «endurecer la
 * validación» acaba siendo «romper el entorno de todo el mundo», y encima se descubre tarde.
 */

/** Un entorno de producción COMPLETO y válido. Cada test le quita una pieza. */
const PRODUCCION_COMPLETA: Record<string, string> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db.interno:5432/marketplace',
  REDIS_URL: 'redis://cache.interno:6379',
  MEILI_HOST: 'https://search.interno:7700',
  MEILI_MASTER_KEY: 'una-master-key',
  MEILI_INDEX_NAME: 'listings_nicho',
  JWT_SECRET: 'un-secreto-largo-de-verdad',
  GOOGLE_CLIENT_ID: 'algo.apps.googleusercontent.com',
  RESEND_API_KEY: 're_lo_que_sea',
  RESEND_FROM: 'noreply@midominio.es',
  APP_URL: 'https://midominio.es',
  S3_ENDPOINT: 'https://cuenta.r2.cloudflarestorage.com',
  S3_BUCKET: 'marketplace',
  S3_ACCESS_KEY_ID: 'id',
  S3_SECRET_ACCESS_KEY: 'secreto',
  S3_PUBLIC_URL: 'https://cdn.midominio.es',
  REVALIDATE_SECRET: 'el-mismo-que-en-web',
  STRIPE_SECRET_KEY: 'sk_live_lo_que_sea',
  STRIPE_WEBHOOK_SECRET: 'whsec_lo_que_sea',
  CONTACT_FORM_SECRET: 'dieciseis-caracteres-o-mas',
};

/** Un entorno de desarrollo tal y como lo describe `apps/api/.env.example`. */
const DESARROLLO_MINIMO: Record<string, string> = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://marketplace:marketplace_dev@127.0.0.1:5432/marketplace',
  REDIS_URL: 'redis://127.0.0.1:6379',
  MEILI_HOST: 'http://127.0.0.1:7700',
  MEILI_MASTER_KEY: 'masterKey_dev_change_me',
  JWT_SECRET: 'change_me_in_production_use_a_long_random_string',
  RESEND_API_KEY: 're_your_api_key_here',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_BUCKET: 'marketplace',
  S3_ACCESS_KEY_ID: 'minioadmin',
  S3_SECRET_ACCESS_KEY: 'minioadmin',
  S3_PUBLIC_URL: 'http://127.0.0.1:9000/marketplace',
  CONTACT_FORM_SECRET: 'change_me_use_a_long_random_string',
};

/** Un entorno de test tal y como lo describe `apps/api/.env.test.example`. */
const TEST_MINIMO: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://marketplace:marketplace_dev@127.0.0.1:5432/marketplace_test',
  REDIS_URL: 'redis://127.0.0.1:6379/1',
  MEILI_HOST: 'http://127.0.0.1:7700',
  MEILI_MASTER_KEY: 'masterKey_dev_change_me',
  MEILI_INDEX_NAME: 'listings_test',
  JWT_SECRET: 'test-jwt-secret',
  RESEND_API_KEY: 'test',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_BUCKET: 'marketplace-test',
  S3_ACCESS_KEY_ID: 'minioadmin',
  S3_SECRET_ACCESS_KEY: 'minioadmin',
  S3_PUBLIC_URL: 'http://127.0.0.1:9000/marketplace-test',
  REDSYS_SECRET_KEY: 'Y2lfcmVkc3lzX2R1bW15X2tleV8yMDI2',
  CONTACT_FORM_SECRET: 'ci_contact_form_secret_32_chars_x',
};

/** `abortEarly: false` para ver TODOS los fallos, como hace ConfigModule. */
function validar(env: Record<string, string>) {
  return envValidationSchema.validate(env, { abortEarly: false, allowUnknown: true });
}

function sin(env: Record<string, string>, clave: string) {
  const copia = { ...env };
  delete copia[clave];
  return copia;
}

describe('BARRERA 1 — producción NO ARRANCA sin lo esencial (fail-closed)', () => {
  it('el entorno de producción completo es válido (si no, los demás tests no dirían nada)', () => {
    expect(validar(PRODUCCION_COMPLETA).error).toBeUndefined();
  });

  /**
   * Las OCHO variables que arrancaban rotas y en silencio, una por una.
   *
   * MUTACIÓN QUE ESTE BLOQUE MATA: quitarle el `is: 'production'` a cualquiera de ellas
   * —volver a `.optional()`— hace que producción arranque sin esa variable. Aquí se cae.
   */
  const ESENCIALES = [
    'APP_URL',
    'RESEND_FROM',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'GOOGLE_CLIENT_ID',
    'REVALIDATE_SECRET',
    'MEILI_INDEX_NAME',
  ];

  it.each(ESENCIALES)('sin %s, producción se niega a arrancar', (clave) => {
    const { error } = validar(sin(PRODUCCION_COMPLETA, clave));
    expect(error).toBeDefined();
    expect(error!.details.some((d) => d.path[0] === clave)).toBe(true);
  });

  /**
   * El mensaje es la mitad del valor. Un `"APP_URL" is required` obliga a ir al código a
   * entender qué se rompe; el nuestro lo dice. Se comprueba que NOMBRA la variable y que
   * explica la consecuencia, no sólo que exista un error.
   */
  it.each(ESENCIALES)('y el mensaje de %s nombra la variable y dice qué se rompe', (clave) => {
    const { error } = validar(sin(PRODUCCION_COMPLETA, clave));
    const mensaje = error!.details.find((d) => d.path[0] === clave)!.message;

    expect(mensaje).toContain(clave);
    expect(mensaje).toMatch(/obligatoria en producción/);
    // Un mensaje de Joi por omisión son ~25 caracteres (`"X" is required`). Exigir
    // longitud impide que alguien «simplifique» los mensajes y deje el genérico.
    expect(mensaje.length).toBeGreaterThan(80);
  });

  it('las tres de cada vez: el error las lista TODAS, no sólo la primera', () => {
    let env = PRODUCCION_COMPLETA;
    for (const c of ['APP_URL', 'STRIPE_SECRET_KEY', 'REVALIDATE_SECRET']) env = sin(env, c);

    const claves = validar(env).error!.details.map((d) => d.path[0]);
    expect(claves).toEqual(expect.arrayContaining(['APP_URL', 'STRIPE_SECRET_KEY', 'REVALIDATE_SECRET']));
  });

  it('una cadena VACÍA no cuela donde no cuela la ausencia', () => {
    for (const clave of ESENCIALES) {
      const { error } = validar({ ...PRODUCCION_COMPLETA, [clave]: '' });
      expect(error?.details.some((d) => d.path[0] === clave)).toBe(true);
    }
  });

  it('ni una cadena de SOLO ESPACIOS', () => {
    const { error } = validar({ ...PRODUCCION_COMPLETA, STRIPE_SECRET_KEY: '   ' });
    expect(error?.details.some((d) => d.path[0] === 'STRIPE_SECRET_KEY')).toBe(true);
  });

  it('APP_URL tiene que ser una URI absoluta: un host suelto no vale', () => {
    // Es lo que se compara LITERALMENTE con la cabecera `Origin`, así que
    // "midominio.es" (sin esquema) autorizaría a nadie y sería dificilísimo de ver.
    const { error } = validar({ ...PRODUCCION_COMPLETA, APP_URL: 'midominio.es' });
    expect(error?.details.some((d) => d.path[0] === 'APP_URL')).toBe(true);
  });

  it('RESEND_FROM rechaza el PLACEHOLDER, no sólo la ausencia', () => {
    // Que sea obligatoria no basta: se puede satisfacer copiándola del `.env.example`.
    const { error } = validar({ ...PRODUCCION_COMPLETA, RESEND_FROM: REMITENTE_PLACEHOLDER });
    const detalle = error?.details.find((d) => d.path[0] === 'RESEND_FROM');
    expect(detalle).toBeDefined();
    expect(detalle!.message).toContain(REMITENTE_PLACEHOLDER);
  });
});

describe('BARRERA 2 — development y test siguen EXACTAMENTE igual', () => {
  it('un .env de desarrollo mínimo sigue siendo válido (sin ninguna de las ocho)', () => {
    expect(validar(DESARROLLO_MINIMO).error).toBeUndefined();
  });

  it('un .env.test mínimo sigue siendo válido', () => {
    expect(validar(TEST_MINIMO).error).toBeUndefined();
  });

  it.each(['APP_URL', 'RESEND_FROM', 'STRIPE_SECRET_KEY', 'GOOGLE_CLIENT_ID', 'REVALIDATE_SECRET'])(
    'en desarrollo, %s sigue sin ser obligatoria',
    (clave) => {
      expect(validar(sin(DESARROLLO_MINIMO, clave)).error).toBeUndefined();
    },
  );

  it('en test, MEILI_INDEX_NAME conserva su regla propia (debe llevar "_test")', () => {
    // La rama nueva de producción se añadió con `switch`, y lo que había que no romper
    // era justo esto: la regla de test es más ESTRICTA que la de producción, no otra.
    const { error } = validar({ ...TEST_MINIMO, MEILI_INDEX_NAME: 'listings' });
    expect(error?.details.some((d) => d.path[0] === 'MEILI_INDEX_NAME')).toBe(true);
  });

  it('en desarrollo, MEILI_INDEX_NAME sigue siendo opcional (hay defecto en SearchService)', () => {
    expect(validar(sin(DESARROLLO_MINIMO, 'MEILI_INDEX_NAME')).error).toBeUndefined();
  });

  it('las cuatro reglas de test que ya existían siguen mordiendo', () => {
    const casos: Array<[string, string]> = [
      ['DATABASE_URL', 'postgresql://u:p@127.0.0.1:5432/marketplace'], // sin _test
      ['REDIS_URL', 'redis://127.0.0.1:6379'], // db 0
      ['MEILI_INDEX_NAME', 'listings'], // sin _test
      ['REDSYS_SECRET_KEY', ''], // vacía
    ];
    for (const [clave, valor] of casos) {
      const { error } = validar({ ...TEST_MINIMO, [clave]: valor });
      expect(error?.details.some((d) => d.path[0] === clave)).toBe(true);
    }
  });
});

describe('BARRERA 4 — MAPTILER_API_KEY es condicional sobre el PROVEEDOR, no sobre el entorno', () => {
  it('con GEOCODING_PROVIDER=maptiler y sin clave, producción no arranca', () => {
    const { error } = validar({ ...PRODUCCION_COMPLETA, GEOCODING_PROVIDER: 'maptiler' });
    expect(error?.details.some((d) => d.path[0] === 'MAPTILER_API_KEY')).toBe(true);
  });

  it('con GEOCODING_PROVIDER=maptiler y con clave, sí arranca', () => {
    const { error } = validar({
      ...PRODUCCION_COMPLETA,
      GEOCODING_PROVIDER: 'maptiler',
      MAPTILER_API_KEY: 'una-clave',
    });
    expect(error).toBeUndefined();
  });

  it('con nominatim NO se exige la clave: no se pide una credencial que no se usa', () => {
    const { error } = validar({ ...PRODUCCION_COMPLETA, GEOCODING_PROVIDER: 'nominatim' });
    expect(error).toBeUndefined();
  });

  it('sin declarar el proveedor tampoco: el defecto es nominatim', () => {
    // El `when` mira el valor RESUELTO del hermano, defecto incluido. Se comprueba
    // porque es justo la clase de cosa que se supone y luego no es verdad.
    const { error, value } = validar(PRODUCCION_COMPLETA);
    expect(error).toBeUndefined();
    expect(value.GEOCODING_PROVIDER).toBe('nominatim');
  });

  it('y muerde también en DESARROLLO: el fallo llega al publicar, no al arrancar', () => {
    const { error } = validar({ ...DESARROLLO_MINIMO, GEOCODING_PROVIDER: 'maptiler' });
    expect(error?.details.some((d) => d.path[0] === 'MAPTILER_API_KEY')).toBe(true);
  });
});
