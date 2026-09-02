import { esRutaDeBlog, resolveBrand, type BrandZone } from './brand';
import { SITE_NAME } from '@/config';

/**
 * TRES LOGOS L2 — LAS BARRERAS DEL RESPALDO (§6).
 *
 * POR QUÉ ESTO ES UN TEST UNITARIO Y NO SÓLO UN PLAYWRIGHT. La regla es «ninguna zona
 * se queda sin marca», y eso son ocho combinaciones por zona (cada logo puesto o no)
 * más el caso de que el backend no responda. Comprobarlas en el navegador exigiría
 * subir y quitar ficheros veinticuatro veces contra un estado global que comparten
 * todas las specs. Aquí la cadena se ejerce entera, en milisegundos y sin tocar nada.
 *
 * Lo que Playwright sí pinza —que la cabecera de verdad monta esto y que el logo llega
 * al navegador— vive en `e2e/logos-marca.spec.ts`.
 */

const NADA = { public: null, backoffice: null, blog: null };
const PUB = 'https://cdn.example/branding/publico.svg';
const BACK = 'https://cdn.example/branding/backoffice.png';
const BLOG = 'https://cdn.example/branding/blog.webp';

const ZONAS: BrandZone[] = ['public', 'backoffice', 'blog'];

describe('resolveBrand — cada zona su logo', () => {
  it('con los tres subidos, cada zona muestra EL SUYO (son independientes)', () => {
    const logos = { public: PUB, backoffice: BACK, blog: BLOG };
    expect(resolveBrand('public', logos).src).toBe(PUB);
    expect(resolveBrand('backoffice', logos).src).toBe(BACK);
    expect(resolveBrand('blog', logos).src).toBe(BLOG);
  });

  it('el logo de una zona NO se cuela en otra', () => {
    // Sólo el del blog: el público no tiene de dónde caer y el backoffice tampoco
    // —su cadena mira su logo y el PÚBLICO, nunca el del blog—.
    const soloBlog = { ...NADA, blog: BLOG };
    expect(resolveBrand('public', soloBlog).src).toBeNull();
    expect(resolveBrand('backoffice', soloBlog).src).toBeNull();
    expect(resolveBrand('blog', soloBlog).src).toBe(BLOG);
  });
});

describe('BARRERA — NINGUNA zona se queda sin marca', () => {
  // La mutación que esto mata: quitarle el respaldo al componente. Sin él, una
  // instancia recién desplegada —que es TODA instancia el primer día— tendría las tres
  // cabeceras vacías.
  it.each(ZONAS)('sin ningún logo, la zona «%s» sigue teniendo texto', (zone) => {
    const marca = resolveBrand(zone, NADA);
    expect(marca.src).toBeNull();
    expect(marca.text.length).toBeGreaterThan(0);
  });

  it.each(ZONAS)('si el backend NO responde (null), la zona «%s» tampoco queda vacía', (zone) => {
    // Es el caso del `.catch(() => null)` de la cabecera: un backend caído deja la
    // marca en el nombre del sitio, que es lo que se pintaba antes de esta ráfaga.
    expect(resolveBrand(zone, null).text.length).toBeGreaterThan(0);
    expect(resolveBrand(zone, undefined).text.length).toBeGreaterThan(0);
  });

  it('el texto del público y el del blog son el nombre del sitio', () => {
    expect(resolveBrand('public', NADA).text).toBe(SITE_NAME);
    expect(resolveBrand('blog', NADA).text).toBe(SITE_NAME);
  });

  it('el del BACKOFFICE nombra la instancia — es el multi-instancia sin subir nada', () => {
    // «Backoffice» a secas —lo que había— es igual en coches.x y en motos.x, así que no
    // contesta la única pregunta que esa cabecera existe para contestar.
    const texto = resolveBrand('backoffice', NADA).text;
    expect(texto).toBe(`${SITE_NAME} · Backoffice`);
    expect(texto).toContain(SITE_NAME);
  });
});

describe('BARRERA — la cadena: backoffice y blog caen al logo PÚBLICO antes que al texto', () => {
  const soloPublico = { ...NADA, public: PUB };

  it.each(['backoffice', 'blog'] as const)(
    'con SÓLO el logo público, «%s» muestra ese logo y no texto',
    (zone) => {
      expect(resolveBrand(zone, soloPublico).src).toBe(PUB);
    },
  );

  it('el logo propio GANA al público', () => {
    expect(resolveBrand('backoffice', { ...soloPublico, backoffice: BACK }).src).toBe(BACK);
    expect(resolveBrand('blog', { ...soloPublico, blog: BLOG }).src).toBe(BLOG);
  });

  it('el texto NO cambia al caer al logo público: sigue siendo el de SU zona', () => {
    // El respaldo afecta a la imagen, no al nombre: el `alt` del logo público mostrado
    // en el backoffice sigue diciendo que esto es el backoffice de esta instancia.
    expect(resolveBrand('backoffice', soloPublico).text).toBe(`${SITE_NAME} · Backoffice`);
  });

  it('el público NO tiene segundo eslabón: sin su logo, su nombre', () => {
    // No hay de dónde caer, y una imagen genérica de fábrica sería peor que el nombre:
    // parecería la marca de otro.
    const marca = resolveBrand('public', { ...NADA, backoffice: BACK, blog: BLOG });
    expect(marca.src).toBeNull();
    expect(marca.text).toBe(SITE_NAME);
  });
});

describe('esRutaDeBlog — por SEGMENTO, no por prefijo de texto', () => {
  it.each(['/blog', '/blog/', '/blog/mi-articulo', '/blog/2026/enero'])('%s es blog', (ruta) => {
    expect(esRutaDeBlog(ruta)).toBe(true);
  });

  it.each(['/', '/busqueda', '/anuncio/x', '/paginas/ayuda', '/blogueros', '/blogs'])(
    '%s NO es blog',
    (ruta) => {
      // `/blogueros` y `/blogs` son la cicatriz R4 de `sectionForPath`: con un
      // `startsWith('/blog')` pelado heredarían el logo del blog sin que nadie lo
      // decidiera. Hoy no existen; la clase de error sí.
      expect(esRutaDeBlog(ruta)).toBe(false);
    },
  );

  it('sin pathname (null) no es blog — la zona por defecto es la pública', () => {
    expect(esRutaDeBlog(null)).toBe(false);
    expect(esRutaDeBlog(undefined)).toBe(false);
    expect(esRutaDeBlog('')).toBe(false);
  });
});
