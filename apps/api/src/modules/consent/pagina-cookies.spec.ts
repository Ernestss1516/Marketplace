/**
 * COOKIES RÁFAGA 3 — LOS HUECOS DE LA PÁGINA TIENEN QUE GRITAR.
 *
 * En cumplimiento, un marcador de posición que parece un dato real es peligroso de una
 * forma concreta: alguien publica la página sin releerla y la política acaba declarando
 * una duración inventada. Eso es peor que no tener página, porque una política falsa se
 * cree.
 *
 * Por eso estos casos no comprueban que «haya texto»: comprueban que **lo que falta se
 * ve como que falta**, y que ningún hueco lleva un valor plausible dentro. La lista de
 * bloques vive en su propio módulo, sin `main()`, justamente para poder mirarla así — el
 * mismo motivo por el que `SEED_SETTINGS` se sacó de `seed.ts` en su día.
 */

import {
  PAGINA_COOKIES_BLOQUES,
  PAGINA_COOKIES_RUTA,
  PAGINA_COOKIES_SLUG,
} from '../../../prisma/seed-pagina-cookies';

type Bloque = { id: string; type: string; markdown?: string; headers?: string[]; rows?: string[][] };

const BLOQUES = PAGINA_COOKIES_BLOQUES as unknown as Bloque[];

/** Todo el texto de la página, para buscar en él sin recorrer cada tipo de bloque. */
const TEXTO_COMPLETO = JSON.stringify(BLOQUES);

const MARCA = '⚠️ PENDIENTE';

describe('la página de cookies — estructura', () => {
  it('vive en /paginas/cookies', () => {
    expect(PAGINA_COOKIES_SLUG).toBe('cookies');
    expect(PAGINA_COOKIES_RUTA).toBe('/paginas/cookies');
  });

  it('todos los bloques tienen id y tipo, y los tipos son de los que el CMS conoce', () => {
    // Si un tipo no existiera, el backend rechazaría la página al guardarla y el
    // renderizador fallaría en build por el switch exhaustivo. Mejor cazarlo aquí.
    const conocidos = ['text', 'table', 'cookiePreferences'];
    for (const b of BLOQUES) {
      expect(b.id).toBeTruthy();
      expect(conocidos).toContain(b.type);
    }
  });

  it('lleva el panel para cambiar o retirar el consentimiento', () => {
    // Sin él, la política explicaría cómo decidir y no dejaría hacerlo desde donde se
    // está leyendo.
    expect(BLOQUES.filter((b) => b.type === 'cookiePreferences')).toHaveLength(1);
  });

  it('declara la cookie de consentimiento PROPIA', () => {
    // `mp_consent` es una cookie más y la escribimos nosotros: omitirla sería empezar
    // mintiendo justo en el documento que existe para no mentir.
    const tabla = BLOQUES.find((b) => b.id === 'tabla-propias-datos');
    expect(tabla?.rows?.some((fila) => fila[0] === 'mp_consent')).toBe(true);
  });

  it('declara los tres terceros que el gate retiene', () => {
    const tabla = BLOQUES.find((b) => b.id === 'tabla-terceros-datos');
    const proveedores = tabla?.rows?.map((f) => f[0]) ?? [];
    expect(proveedores).toEqual(expect.arrayContaining(['Vimeo', 'YouTube (Google)', 'MapTiler']));
  });

  it('NO inventa categorías que no existen', () => {
    // El texto puede mencionar que NO hay marketing ni analítica —eso es informar—, pero
    // no puede ofrecerlas como categorías. Se comprueba que sólo aparecen en la frase que
    // dice que no las usamos.
    const categorias = BLOQUES.find((b) => b.id === 'categorias')?.markdown ?? '';
    expect(categorias).toContain('Esenciales');
    expect(categorias).toContain('Contenido de terceros');
    // Sin saltos ni marcas de cita: el texto está partido en varias líneas del array y
    // va dentro de un `>` de markdown. Lo que importa es la frase, no dónde corta.
    const frase = categorias.replace(/^>\s?/gm, '').replace(/\s+/g, ' ');
    expect(frase).toMatch(/no hay categoría de «marketing» ni de «analítica»/i);
  });
});

describe('LA BARRERA — los huecos se ven como huecos', () => {
  it('los cuatro datos que hay que medir están marcados, no inventados', () => {
    const tablaPropias = BLOQUES.find((b) => b.id === 'tabla-propias-datos');
    const filas = tablaPropias?.rows ?? [];

    // Tres cookies de Auth.js sin nombre ni duración conocidos: sesión, CSRF y OAuth.
    const sinMedir = filas.filter((f) => f[0].includes(MARCA));
    expect(sinMedir).toHaveLength(3);
    // Y su duración tampoco puede estar inventada.
    for (const fila of sinMedir) expect(fila[3]).toContain(MARCA);

    // El cuarto: lo que escriben los terceros.
    const tablaTerceros = BLOQUES.find((b) => b.id === 'tabla-terceros-datos');
    for (const fila of tablaTerceros?.rows ?? []) {
      expect(fila[2]).toContain(MARCA);
    }
  });

  it('ningún hueco lleva un valor que PAREZCA medido', () => {
    /**
     * LA MUTACIÓN QUE ESTE CASO EXISTE PARA CAZAR: que alguien rellene un hueco con algo
     * verosímil —`authjs.session-token`, `30 días`— para «dejarlo bonito» mientras llega
     * la medición de verdad. Eso es exactamente lo peligroso: se publica y nadie vuelve.
     *
     * Se comprueba al revés de lo habitual: donde falta el dato, NO puede haber nada que
     * se le parezca.
     */
    const filas = BLOQUES.find((b) => b.id === 'tabla-propias-datos')?.rows ?? [];
    for (const fila of filas) {
      const [nombre, , , duracion] = fila;
      if (!nombre.includes(MARCA)) continue;
      // Ni un nombre de cookie plausible colado en la celda del hueco…
      expect(nombre).not.toMatch(/authjs|next-auth|__Secure|__Host/i);
      // …ni una duración inventada en la suya.
      expect(duracion).not.toMatch(/\b\d+\s*(día|días|mes|meses|hora|horas|año|años)\b/i);
    }
  });

  it('el texto legal pendiente está marcado, y dice quién lo escribe', () => {
    // Cuatro apartados los redacta asesoría (D8): qué son las cookies, la revisión del
    // apartado de telemetría, cómo borrarlas en cada navegador y el contacto.
    const conPendiente = BLOQUES.filter((b) => (b.markdown ?? '').includes(MARCA));
    expect(conPendiente.length).toBeGreaterThanOrEqual(4);
    expect(TEXTO_COMPLETO).toContain('texto de asesoría legal');
  });

  it('el aviso de «no publicar» va EL PRIMERO', () => {
    // Quien abra la página en el editor tiene que tropezarse con él antes que con nada.
    expect(BLOQUES[0].id).toBe('aviso-borrador');
    expect(BLOQUES[0].markdown).toContain('NO ESTÁ TERMINADA');
    expect(BLOQUES[0].markdown).toContain('No la publiques todavía');
  });

  it('dice CÓMO cerrar cada hueco, no sólo que existe', () => {
    // Un «PENDIENTE» sin instrucciones traslada el problema en vez de resolverlo: quien
    // lo lea dentro de tres meses no sabrá que esos datos se miden en el navegador y no
    // se leen del código.
    expect(TEXTO_COMPLETO).toContain('herramientas de desarrollo');
    expect(TEXTO_COMPLETO).toContain('ventana privada');
    // Y el enganche con el ajuste que hace que el banner enlace aquí.
    expect(TEXTO_COMPLETO).toContain('Administración → Cookies');
  });
});
