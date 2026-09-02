/**
 * DESPLIEGUE GRUPO A — BARRERA 5: los dominios de medios.
 *
 * ── POR QUÉ SE RECARGA EL MÓDULO EN CADA CASO ────────────────────────────────────────────
 *
 * `remotePatterns` se calcula UNA VEZ, al importar, porque es lo que consume
 * `next.config.ts` a nivel de módulo. Así que no se puede cambiar la variable de entorno y
 * volver a leer la constante: hay que volver a evaluar el módulo (`jest.resetModules()` +
 * `require`). Es feo y es la única forma de probar de verdad lo que hace el fichero; la
 * alternativa —exportar una función y probar la función— probaría algo que Next no usa.
 */

const REAL_ENV = process.env.NEXT_PUBLIC_MEDIA_URL;

function cargar(mediaUrl?: string) {
  jest.resetModules();
  if (mediaUrl === undefined) delete process.env.NEXT_PUBLIC_MEDIA_URL;
  else process.env.NEXT_PUBLIC_MEDIA_URL = mediaUrl;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./image-domains') as typeof import('./image-domains');
}

afterAll(() => {
  if (REAL_ENV === undefined) delete process.env.NEXT_PUBLIC_MEDIA_URL;
  else process.env.NEXT_PUBLIC_MEDIA_URL = REAL_ENV;
});

describe('El dominio público de producción entra en la lista', () => {
  it('un dominio PROPIO de R2 queda autorizado', () => {
    const { remotePatterns, isSafeSrc } = cargar('https://cdn.midominio.es/marketplace');

    expect(remotePatterns).toContainEqual({ protocol: 'https', hostname: 'cdn.midominio.es' });
    expect(isSafeSrc('https://cdn.midominio.es/listing-images/a/b.webp')).toBe(true);
  });

  it('y el `pub-….r2.dev` de quien no ponga dominio propio, también', () => {
    // Los dos casos que el patrón viejo `*.r2.cloudflarestorage.com` NO cubría, que es
    // exactamente por lo que en producción no se habría visto ni una imagen.
    const { isSafeSrc } = cargar('https://pub-0123456789abcdef.r2.dev');

    expect(isSafeSrc('https://pub-0123456789abcdef.r2.dev/listing-images/a/b.webp')).toBe(true);
  });

  it('el puerto no importa (MinIO en un host propio)', () => {
    const { isSafeSrc } = cargar('http://minio.interno:9000/marketplace');
    expect(isSafeSrc('http://minio.interno:9000/x/y.webp')).toBe(true);
  });

  it('MUTACIÓN — sin la variable, el dominio de producción NO se sirve', () => {
    // El defecto original, reproducido: la lista existe, la red funciona, y la imagen no
    // se pinta. Es el fallo que este grupo cierra y el que esta barrera vigila.
    const { isSafeSrc } = cargar(undefined);
    expect(isSafeSrc('https://cdn.midominio.es/listing-images/a/b.webp')).toBe(false);
  });
});

describe('El endpoint S3 de R2 ya NO está autorizado', () => {
  it('`*.r2.cloudflarestorage.com` no se cuela por el mero hecho de ser de R2', () => {
    // No sólo era el host equivocado: autorizaba el endpoint S3 de CUALQUIER cuenta de R2.
    const { isSafeSrc } = cargar('https://cdn.midominio.es');
    expect(isSafeSrc('https://otracuenta.r2.cloudflarestorage.com/bucket/x.webp')).toBe(false);
  });

  it('y si alguien apunta NEXT_PUBLIC_MEDIA_URL al endpoint S3, sólo se autoriza ESE host', () => {
    // Configuración desaconsejada pero posible; lo que no puede pasar es que se convierta
    // otra vez en un comodín sobre el dominio entero.
    const { isSafeSrc } = cargar('https://micuenta.r2.cloudflarestorage.com/bucket');
    expect(isSafeSrc('https://micuenta.r2.cloudflarestorage.com/bucket/x.webp')).toBe(true);
    expect(isSafeSrc('https://otracuenta.r2.cloudflarestorage.com/bucket/x.webp')).toBe(false);
  });
});

describe('Desarrollo sigue funcionando', () => {
  it('localhost y 127.0.0.1 siguen en la lista con y sin la variable', () => {
    for (const media of [undefined, 'https://cdn.midominio.es']) {
      const { isSafeSrc } = cargar(media);
      expect(isSafeSrc('http://localhost:9000/marketplace/x.webp')).toBe(true);
      expect(isSafeSrc('http://127.0.0.1:9000/marketplace/x.webp')).toBe(true);
    }
  });
});

describe('Un valor mal puesto degrada, no rompe el build', () => {
  it.each(['', 'no-es-una-url', 'ftp://host/x', 'javascript:alert(1)'])(
    'con NEXT_PUBLIC_MEDIA_URL="%s" la lista sigue siendo usable',
    (valor) => {
      const { remotePatterns, isSafeSrc } = cargar(valor);
      // Los dos de desarrollo, y ninguno inventado.
      expect(remotePatterns).toHaveLength(2);
      expect(isSafeSrc('http://localhost:9000/x.webp')).toBe(true);
    },
  );
});

describe('isSafeSrc no se deja engañar por parecidos', () => {
  it.each([
    'https://cdn.midominio.es.evil.com/x.webp',
    'https://evil.com/https://cdn.midominio.es/x.webp',
    'http://cdn.midominio.es/x.webp', // el esquema cuenta
    'not a url',
  ])('%s no pasa', (url) => {
    const { isSafeSrc } = cargar('https://cdn.midominio.es');
    expect(isSafeSrc(url)).toBe(false);
  });
});
