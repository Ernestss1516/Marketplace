import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';

/**
 * EL NÚCLEO DE BÚSQUEDA NO ALCANZA INFRAESTRUCTURA. **Barrera rápida.**
 *
 * ── POR QUÉ ADEMÁS DE LA DE e2e ─────────────────────────────────────────────────────────
 *
 * `test/comandos-standalone.e2e-spec.ts` levanta los contextos de verdad y es la prueba
 * definitiva. Pero tiene un modo de fallo malo, comprobado al ejercerlo: si alguien deshace
 * el aislamiento, esa suite **no falla — se cuelga**, porque las colas de BullMQ mantienen
 * vivo el event loop y Jest nunca sale. En CI eso son sesenta minutos hasta el `timeout` y
 * un log vacío, que es justo el modo de fallo que este repositorio lleva ráfagas evitando.
 *
 * Ésta no arranca nada: lee el grafo de imports y falla en milisegundos, nombrando el módulo
 * que sobra. Las dos juntas son la barrera; ésta es la que da el diagnóstico.
 *
 * ── SE AFIRMA EL CONJUNTO EXACTO, NO UNA LISTA NEGRA ────────────────────────────────────
 *
 * «Que no aparezca BullModule» dejaría pasar el módulo nuevo que traiga Redis, o gRPC, o lo
 * que sea que se invente dentro de un año — y el defecto que esto persigue ha llegado tres
 * veces por tres caminos distintos. Afirmar el conjunto ENTERO obliga a que cualquier
 * añadido pase por aquí y por una persona que decida si el núcleo debe cargar con él.
 */

const SRC = resolve(__dirname, '..', '..');

/** El fichero sin comentarios: sólo lo que se ejecuta. */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Los módulos que un import relativo puede alcanzar desde un fichero. */
function importsDeModulo(fichero: string): string[] {
  const contenido = readFileSync(fichero, 'utf8');
  const dir = dirname(fichero);
  return [...contenido.matchAll(/from\s+'(\.[^']+)'/g)]
    .map((m) => resolve(dir, m[1]) + '.ts')
    .filter((ruta) => ruta.endsWith('.module.ts') && existsSync(ruta));
}

/** Todos los `*.module.ts` alcanzables desde la entrada, ella incluida. */
function moduloesAlcanzables(entrada: string): string[] {
  const vistos = new Set<string>();
  const pila = [entrada];
  while (pila.length) {
    const actual = pila.pop()!;
    if (vistos.has(actual)) continue;
    vistos.add(actual);
    pila.push(...importsDeModulo(actual));
  }
  return [...vistos].map((r) => relative(SRC, r).replace(/\\/g, '/')).sort();
}

describe('SearchCoreModule — el conjunto de módulos que alcanza', () => {
  const ENTRADA = join(__dirname, 'search-core.module.ts');

  it('alcanza EXACTAMENTE dos módulos, los dos hojas', () => {
    // Si esta lista crece, la pregunta no es «actualizo el test» sino «¿tiene que cargar
    // `pnpm reindex` con esto?». Casi siempre la respuesta será que no, y entonces el
    // módulo nuevo va en `SearchModule` (el del controlador), no aquí.
    expect(moduloesAlcanzables(ENTRADA)).toEqual([
      'infra/meilisearch/meilisearch.module.ts',
      'modules/categories/category-tree.module.ts',
      'modules/search/search-core.module.ts',
    ]);
  });

  it('y ninguno de ellos registra una cola ni toca Redis', () => {
    // SE MIRA EL CÓDIGO, NO LA PROSA. `search-core.module.ts` NOMBRA `BullModule` y
    // `RedisService` en su cabecera, contando por qué existe — y una barrera que se disparase
    // con su propia documentación es una barrera que alguien desactiva o, peor, un incentivo
    // para no escribir el porqué. Misma lección que el falso positivo del base64 de Redsys en
    // la barrera de secretos: precisión antes que celo.
    const sospechosos = moduloesAlcanzables(ENTRADA)
      .map((rel) => [rel, sinComentarios(readFileSync(join(SRC, rel), 'utf8'))] as const)
      .filter(([, c]) => /BullModule|registerQueue|RedisModule|RedisService/.test(c))
      .map(([rel]) => rel);

    expect(sospechosos).toEqual([]);
  });

  it('la regla reconoce lo que persigue (red del propio test)', () => {
    // Una expresión regular rota devolvería siempre una lista vacía y la barrera pasaría en
    // verde sin mirar nada. Se le enseña el grafo de `SearchModule`, que SÍ arrastra la cola
    // — y que es exactamente lo que los comandos dejaron de importar.
    const completo = moduloesAlcanzables(join(__dirname, 'search.module.ts'));

    expect(completo).toContain('modules/reviews/reviews.module.ts');
    expect(completo.length).toBeGreaterThan(3);

    const conCola = completo.filter((rel) =>
      /BullModule|registerQueue/.test(readFileSync(join(SRC, rel), 'utf8')),
    );
    expect(conCola).toContain('modules/reviews/reviews.module.ts');
  });
});

describe('Los comandos standalone importan el núcleo, no la búsqueda completa', () => {
  const COMANDOS = ['reindex.ts', 'geocode-backfill.ts'];

  it.each(COMANDOS)('%s importa SearchCoreModule', (comando) => {
    const fuente = readFileSync(join(SRC, 'commands', comando), 'utf8');
    expect(fuente).toMatch(/import \{ SearchCoreModule \} from/);
  });

  it.each(COMANDOS)('%s NO importa SearchModule (el del controlador)', (comando) => {
    const fuente = readFileSync(join(SRC, 'commands', comando), 'utf8');
    // Sólo la sentencia de import: la cabecera de los dos ficheros MENCIONA `SearchModule`
    // al contar por qué no se usa, y eso hay que poder escribirlo.
    expect(fuente).not.toMatch(/^import \{[^}]*\bSearchModule\b[^}]*\} from/m);
  });

  it.each(COMANDOS)('%s no importa RedisModule ni R2Module', (comando) => {
    // Eran el parche de H6.6 y ya no hacen falta: sin el controlador no hay
    // `SponsoredAdsService` al que satisfacer. Que vuelvan sería la señal de que alguien
    // reintrodujo el arrastre y lo está tapando otra vez.
    const fuente = readFileSync(join(SRC, 'commands', comando), 'utf8');
    expect(fuente).not.toMatch(/^import \{[^}]*\b(RedisModule|R2Module)\b[^}]*\} from/m);
  });
});
