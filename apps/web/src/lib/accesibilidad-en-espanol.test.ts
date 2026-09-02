import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * i18n T4 — BARRERA 1: lo que sólo oye un lector de pantalla, también en español.
 *
 * ── POR QUÉ ES UN BARRIDO Y NO SIETE ASERCIONES ─────────────────────────────────────────
 *
 * Los restos de T4 (`aria-label="Breadcrumb"` ×7, `<span className="sr-only">Close</span>`)
 * no llegaron ahí de uno en uno: llegaron **copiando**. El `Close` es un sobrante de shadcn
 * que aparece en cada componente que se instala; el `Breadcrumb` se propagó porque cada
 * pantalla nueva copiaba la anterior. Arreglar las ocho ocurrencias y no poner barrera deja
 * intacta la fuente: la novena llegaría igual, y nadie la vería, porque **esto no se ve —se
 * oye**, y sólo si alguien navega el sitio con un lector de pantalla.
 *
 * Así que se persigue la CLASE: ningún `aria-label` ni ningún `sr-only` de todo el frontend
 * puede contener una de las palabras inglesas que shadcn y las plantillas dejan caer.
 *
 * ── LA LISTA ES DE PALABRAS INGLESAS, NO UN DETECTOR DE IDIOMA ──────────────────────────
 *
 * Un «¿esto está en español?» automático sería un adivino con falsos positivos (`Email`,
 * `Spam`, `Pro`, `Redsys` son español de uso corriente aquí, y la auditoría los excluye a
 * propósito en su §6). Una lista corta de los términos que de verdad se cuelan es exacta,
 * se lee de un vistazo y crece cuando aparece uno nuevo.
 */

const SRC = join(__dirname, '..');

/** Los términos que shadcn y las plantillas dejan en inglés en textos accesibles. */
const PALABRAS_INGLESAS = [
  'Breadcrumb',
  'Close',
  'Open',
  'Search',
  'Menu',
  'Toggle',
  'Previous',
  'Next',
  'Loading',
  'Submit',
  'Dismiss',
  'Expand',
  'Collapse',
];

/** `aria-label="…"` y `<span className="sr-only">…</span>` con texto literal dentro. */
const TEXTOS_ACCESIBLES = /aria-label="([^"{}]+)"|className="sr-only"\s*>\s*([^<{][^<]*)</g;

function fuentes(dir: string): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) return fuentes(ruta);
    return /\.tsx?$/.test(entrada) && !/\.(test|spec)\.tsx?$/.test(entrada) ? [ruta] : [];
  });
}

const FICHEROS = fuentes(SRC);

function infractores(): string[] {
  const encontrados: string[] = [];
  for (const ruta of FICHEROS) {
    const contenido = readFileSync(ruta, 'utf8');
    for (const m of contenido.matchAll(TEXTOS_ACCESIBLES)) {
      const texto = (m[1] ?? m[2] ?? '').trim();
      if (!texto) continue;
      // Palabra entera: «Cerrar sesión» no es «Close», y «Buscar» no es «Search».
      const mala = PALABRAS_INGLESAS.find((p) => new RegExp(`\\b${p}\\b`).test(texto));
      if (mala) encontrados.push(`${ruta.slice(SRC.length + 1).replace(/\\/g, '/')} → "${texto}"`);
    }
  }
  return encontrados;
}

describe('i18n T4 — ningún texto accesible en inglés', () => {
  it('el barrido encuentra ficheros (red del propio test)', () => {
    // Sin esto, un `readdirSync` que devolviera vacío haría pasar la barrera entera sin
    // mirar nada — el fallo más silencioso que puede tener un test de barrido. Molde de
    // `etiquetas-enums.test.ts`.
    expect(FICHEROS.length).toBeGreaterThan(200);
  });

  it('la propia regla reconoce la forma que persigue (segunda red)', () => {
    // Una expresión regular rota tampoco encontraría nada y también pasaría en verde. Se le
    // enseña un caso positivo y uno negativo de cada una de las dos formas.
    const positivos = [
      '<nav aria-label="Breadcrumb">',
      '<span className="sr-only">Close</span>',
    ];
    const negativos = [
      '<nav aria-label="Ruta de navegación">',
      '<span className="sr-only">Cerrar</span>',
    ];

    const caza = (fuente: string) =>
      [...fuente.matchAll(TEXTOS_ACCESIBLES)].some((m) => {
        const t = (m[1] ?? m[2] ?? '').trim();
        return PALABRAS_INGLESAS.some((p) => new RegExp(`\\b${p}\\b`).test(t));
      });

    for (const f of positivos) expect(caza(f)).toBe(true);
    for (const f of negativos) expect(caza(f)).toBe(false);
  });

  it('y no marca lo que la auditoría excluyó a propósito (§6)', () => {
    // `Email`, `Total`, `Spam`, `Pro`… son español de uso corriente aquí. Una barrera que
    // los persiguiera se desactivaría en una semana.
    const caza = (fuente: string) =>
      [...fuente.matchAll(TEXTOS_ACCESIBLES)].some((m) => {
        const t = (m[1] ?? m[2] ?? '').trim();
        return PALABRAS_INGLESAS.some((p) => new RegExp(`\\b${p}\\b`).test(t));
      });

    expect(caza('<span className="sr-only">Email del vendedor</span>')).toBe(false);
    expect(caza('<button aria-label="Marcar como Spam">')).toBe(false);
  });

  it('nadie deja un aria-label ni un sr-only en inglés', () => {
    expect(infractores()).toEqual([]);
  });
});

describe('i18n T4 — el término canónico de las migas de pan', () => {
  it('las siete superficies con migas de pan dicen «Ruta de navegación»', () => {
    // Siete, y todas iguales. Que cada pantalla eligiera su sinónimo sería el mismo defecto
    // de dispersión que T3 cerró en el vocabulario: un lector de pantalla oiría cuatro
    // nombres distintos para la misma cosa.
    //
    // SE CUENTAN FICHEROS Y NO OCURRENCIAS a propósito: `Breadcrumbs.tsx` lo dice dos veces
    // —el atributo y el comentario que documenta ese marcado— y contar apariciones haría que
    // esta cifra dependiera de cuánta documentación lleve el componente, que no es lo que
    // esta barrera quiere vigilar.
    const conMigas = FICHEROS.filter((r) =>
      /aria-label="Ruta de navegación"/.test(readFileSync(r, 'utf8')),
    ).map((r) => r.slice(SRC.length + 1).replace(/\\/g, '/'));

    expect(conMigas.sort()).toEqual([
      'app/(public)/anuncio/[slug]/page.tsx',
      'app/(public)/blog/[slug]/page.tsx',
      'app/(public)/blog/page.tsx',
      'app/(public)/busqueda/page.tsx',
      'app/(public)/paginas/[slug]/page.tsx',
      'components/categorias/CategoryListingPage.tsx',
      'components/shared/Breadcrumbs.tsx',
    ]);
  });

  it('«Ruta de categoría» sigue siendo suya y NO se ha unificado', () => {
    // `StepCategoria` no pinta migas de pan: pinta el camino de categorías del wizard. Es
    // el precedente del que sale la fórmula «Ruta de …», no un octavo caso que arreglar.
    const wizard = readFileSync(
      join(SRC, 'components', 'publicar', 'steps', 'StepCategoria.tsx'),
      'utf8',
    );
    expect(wizard).toContain('aria-label="Ruta de categoría"');
  });
});
