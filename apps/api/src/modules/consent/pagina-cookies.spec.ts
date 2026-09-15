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
/** «Aquí hay un dato real, medido, que nadie ha confirmado todavía en un navegador.» */
const SIN_CONFIRMAR = '⚠️ SIN CONFIRMAR';

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
  it('ya no queda ningún hueco PENDIENTE en las tablas: los cuatro datos están medidos', () => {
    /**
     * La ráfaga de medición cerró los cuatro huecos con datos de runtime real. Este caso
     * es el que impide que vuelvan a abrirse sin querer — y, sobre todo, el que impide
     * que alguien «resuelva» un fallo de los de abajo borrando la fila en vez de midiendo.
     */
    const propias = BLOQUES.find((b) => b.id === 'tabla-propias-datos')?.rows ?? [];
    const terceros = BLOQUES.find((b) => b.id === 'tabla-terceros-datos')?.rows ?? [];

    for (const fila of [...propias, ...terceros]) {
      for (const celda of fila) expect(celda).not.toContain(MARCA);
    }

    // Y las cookies de Auth.js que la medición encontró siguen ahí, con nombre real.
    const nombres = propias.map((f) => f[0]).join(' ');
    expect(nombres).toContain('authjs.session-token');
    expect(nombres).toContain('authjs.csrf-token');
    expect(nombres).toContain('authjs.pkce.code_verifier');
  });

  it('TODO dato medido va marcado como SIN CONFIRMAR mientras nadie lo haya comprobado', () => {
    /**
     * LA MUTACIÓN QUE ESTE CASO EXISTE PARA CAZAR, y es la misma de siempre con otra
     * ropa: antes el peligro era rellenar un hueco con algo verosímil; ahora es dar por
     * bueno un dato medido en local —sin HTTPS, con un navegador automatizado— como si
     * fuera lo que ve un usuario. Se publica, nadie vuelve, y la política declara un
     * nombre de cookie que en producción es otro (allí lleva `__Secure-`/`__Host-`).
     *
     * Por eso cada celda medida arrastra su marca. Quitarla es un acto deliberado que
     * sólo puede hacer quien haya mirado el navegador de verdad, y que rompe este caso
     * si lo hace a medias.
     */
    const propias = BLOQUES.find((b) => b.id === 'tabla-propias-datos')?.rows ?? [];

    for (const [nombre, , , duracion] of propias) {
      // `mp_consent` es NUESTRA: su nombre y sus 6 meses salen de nuestro propio código
      // (una constante), no de una biblioteca ajena. No hay nada que confirmar ahí.
      if (nombre === 'mp_consent') continue;
      expect(nombre).toContain(SIN_CONFIRMAR);
      expect(duracion).toContain(SIN_CONFIRMAR);
    }

    // Los tres terceros, igual: lo que escriben se midió una vez, en una máquina.
    const terceros = BLOQUES.find((b) => b.id === 'tabla-terceros-datos')?.rows ?? [];
    expect(terceros).toHaveLength(3);
    for (const fila of terceros) expect(fila[2]).toContain(SIN_CONFIRMAR);
  });

  it('los nombres declarados son los de HTTPS, que es como los ve un usuario', () => {
    /**
     * La medición se hizo en local por HTTP, donde Auth.js escribe los nombres SIN
     * prefijo. Declarar esos sería declarar el entorno de desarrollo en un documento
     * legal. La tabla lleva los de producción, y la página explica el porqué del prefijo
     * para que no parezca un error de copia.
     */
    const propias = BLOQUES.find((b) => b.id === 'tabla-propias-datos')?.rows ?? [];
    const deAuthjs = propias.filter((f) => f[0].includes('authjs.'));
    expect(deAuthjs.length).toBeGreaterThanOrEqual(4);
    for (const [nombre] of deAuthjs) expect(nombre).toMatch(/^__(Secure|Host)-authjs\./);

    // La cookie CSRF es la única con `__Host-`: es el prefijo más estricto, y es el que
    // la biblioteca le pone a ésa en concreto. Si alguien lo «uniformara» a `__Secure-`
    // estaría declarando algo falso.
    const csrf = deAuthjs.find((f) => f[0].includes('csrf-token'));
    expect(csrf?.[0]).toContain('__Host-authjs.csrf-token');

    expect(TEXTO_COMPLETO).toContain('__Secure-');
    expect(TEXTO_COMPLETO).toContain('__Host-');
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
    // Sin distinguir mayúsculas: lo que se comprueba es que la instrucción esté, no
    // cómo quedó capitalizada al reescribir el recuadro.
    expect(TEXTO_COMPLETO).toMatch(/herramientas de desarrollo/i);
    expect(TEXTO_COMPLETO).toMatch(/ventana privada/i);
    // Y el enganche con el ajuste que hace que el banner enlace aquí.
    expect(TEXTO_COMPLETO).toContain('Administración → Cookies');
  });
});
