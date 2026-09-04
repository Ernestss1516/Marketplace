import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { escaparHtml, html, serializar, urlSegura } from './email-escapar';
import type { CorreoEstructurado, PiezaCorreo } from './email-piezas';
import { renderCorreo, renderTexto } from './email-render';
import {
  PILA_TIPOGRAFICA,
  TEMA_CORREO_DE_FABRICA,
  temaCorreo,
  type TemaCorreo,
} from './email-tema';
import { MODELO_POR_DEFECTO, resolverTokens } from '../../../modules/estilo/estilo.constants';

/**
 * E8 — LAS BARRERAS DEL CORREO TEMADO.
 *
 * ── QUÉ SE ESTÁ DEFENDIENDO, Y POR QUÉ NO ES UN TEST DE MAQUETACIÓN ─────────────────
 *
 * Hasta E8 este proyecto tenía una invariante ABSOLUTA: el `NotificationProcessor`
 * mandaba `text:` y nunca `html:`, así que **no había forma de que el contenido de un
 * usuario se interpretara**. Cruzarla fue una decisión de Ernest (§7.6 del diseño), y lo
 * que la sostiene ahora no es una promesa: es que la invariante se **trasladó** a «el HTML
 * se compone en un solo sitio y todo dato entra escapado, siempre».
 *
 * Este fichero comprueba ese «siempre» sobre la máquina de serializar, y
 * `test/correos-e8.e2e-spec.ts` lo comprueba sobre los dieciocho envíos reales. Los dos
 * hacen falta: aquí se demuestra que el serializador no tiene grietas; allí, que no hay
 * ningún envío que se lo salte.
 */

// ─────────────────────────────────────────────────────────────────────────────────────
// Utilidades del test
// ─────────────────────────────────────────────────────────────────────────────────────

/** La carga: cada carácter que puede romper el HTML, más una etiqueta entera. */
const VENENO = `<script>alert(1)</script> & "comillas" 'simples' <img src=x onerror=alert(2)>`;

const TEMA: TemaCorreo = TEMA_CORREO_DE_FABRICA;

/**
 * Las etiquetas que el serializador tiene permiso para emitir. **Cerrada a propósito**:
 * la afirmación del §7.5 no es «no aparece `<script>`» sino «no aparece NINGUNA etiqueta
 * nueva», y una lista blanca es la única forma de decir eso sin ir enumerando venenos.
 */
const ETIQUETAS_PERMITIDAS = new Set([
  '!doctype', 'html', 'head', 'meta', 'title', 'body', 'table', 'tr', 'td', 'div', 'a',
  'img', 'br',
]);

/** Los nombres de etiqueta que aparecen de verdad en un HTML, apertura y cierre. */
function etiquetasDe(documento: string): string[] {
  const nombres: string[] = [];
  for (const m of documento.matchAll(/<\/?([a-zA-Z!][a-zA-Z0-9-]*)/g)) {
    nombres.push(m[1].toLowerCase());
  }
  return nombres;
}

/** Un correo con la carga en TODOS los campos de todas las piezas. */
function correoEnvenenado(sobrio = false): CorreoEstructurado {
  return {
    to: 'quien@sea.test',
    subject: `Asunto ${VENENO}`,
    sobrio,
    piezas: [
      { tipo: 'saludo', nombre: VENENO },
      { tipo: 'parrafo', texto: VENENO },
      { tipo: 'cita', texto: VENENO },
      { tipo: 'aviso', texto: VENENO },
      { tipo: 'boton', etiqueta: VENENO, url: `https://ejemplo.test/x?a=1&b=2&c=${VENENO}` },
      { tipo: 'cierre', texto: VENENO },
    ],
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════
// BARRERA 1 — NO HAY VÍA DE ESCAPE: NINGUNA PIEZA ACEPTA MARCADO
// ═════════════════════════════════════════════════════════════════════════════════════

describe('B1 — ninguna pieza puede transportar HTML', () => {
  /**
   * LA BARRERA DE COMPILACIÓN, y es la que Ernest pidió exigir primero.
   *
   * No comprueba una conducta: comprueba que **el código no existe**. Si alguien añadiera
   * un campo `html` a `PiezaCorreo`, esta línea pasaría a compilar y el `@ts-expect-error`
   * se quedaría sin error que esperar — que en TypeScript es, él mismo, un error. O sea
   * que la barrera salta en los dos sentidos: si se añade el campo, y si se borra el test.
   */
  it('un campo de marcado en una pieza NO COMPILA', () => {
    // @ts-expect-error — `PiezaCorreo` no tiene ningún campo donde meter HTML.
    const conMarcado: PiezaCorreo = { tipo: 'parrafo', texto: 'hola', html: '<b>hola</b>' };
    expect(conMarcado.tipo).toBe('parrafo');
  });

  it('un campo de marcado en el correo entero TAMPOCO COMPILA', () => {
    const correo: CorreoEstructurado = {
      to: 'a@b.test',
      subject: 'x',
      // @ts-expect-error — `CorreoEstructurado` sólo tiene piezas.
      html: '<b>x</b>',
      piezas: [],
    };
    expect(correo.piezas).toHaveLength(0);
  });

  /**
   * Y la misma afirmación leída del fichero, por si alguien introdujera el hueco con otro
   * nombre («raw», «markup», «contenidoHtml»…). El `@ts-expect-error` de arriba sólo
   * vigila el nombre `html`.
   */
  it('el fichero de piezas no declara ningún campo de marcado', () => {
    const fuente = readFileSync(join(__dirname, 'email-piezas.ts'), 'utf8');
    // Sólo el cuerpo declarativo: los comentarios sí nombran «HTML» (para explicar que no
    // lo hay), y confundirlos con una declaración sería una barrera que se dispara sola.
    const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(sinComentarios).not.toMatch(/\b(html|raw|markup|marcado|contenidoHtml)\s*[?]?:/i);
  });

  /**
   * EL SERIALIZADOR ES UNO SOLO. `email-escapar.ts` es la única forma de fabricar HTML en
   * todo el backend, y sólo `email-render.ts` la importa: cualquier otro fichero que
   * quisiera componer marcado tendría que pasar por ahí, y este test lo delataría.
   *
   * Es la versión mecánica de la afirmación 2 del §7.5 («enviar() es el único que
   * serializa HTML»), y no depende de que nadie lea un comentario.
   */
  it('sólo el serializador importa la máquina de escapar', () => {
    const raiz = join(__dirname, '..', '..', '..');
    const importadores: string[] = [];

    const recorrer = (dir: string): void => {
      for (const entrada of readdirSync(dir)) {
        const ruta = join(dir, entrada);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (
          ruta.endsWith('.ts') &&
          /from '[^']*email-escapar'/.test(readFileSync(ruta, 'utf8'))
        ) {
          importadores.push(ruta.slice(raiz.length + 1).replace(/\\/g, '/'));
        }
      }
    };
    recorrer(raiz);

    // Este test y el serializador. Nadie más — ni siquiera el processor, que ya sólo
    // entrega piezas.
    expect(importadores.sort()).toEqual([
      'infra/queue/email/correo.spec.ts',
      'infra/queue/email/email-render.ts',
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// BARRERA 2 — EL ESCAPADO, SIN EXCEPCIONES
// ═════════════════════════════════════════════════════════════════════════════════════

describe('B2 — el serializador escapa TODO, siempre', () => {
  it('escaparHtml cubre los cinco caracteres, y `&` va primero', () => {
    expect(escaparHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
    // Si `&` no fuera lo primero, esto saldría `&amp;lt;` — el error clásico del doble
    // escapado, que además rompe el texto legible.
    expect(escaparHtml('<')).toBe('&lt;');
  });

  it('la plantilla escapa lo interpolado y no ofrece ninguna puerta para no hacerlo', () => {
    expect(serializar(html`<p>${VENENO}</p>`)).toBe(`<p>${escaparHtml(VENENO)}</p>`);
    // Un fragmento que ya salió de la plantilla se compone sin volver a escaparse: es lo
    // que permite anidar sin que el marcado propio acabe convertido en entidades.
    expect(serializar(html`<div>${html`<b>x</b>`}</div>`)).toBe('<div><b>x</b></div>');
  });

  it.each([[false], [true]])(
    'un correo con la carga en TODOS los campos no produce ninguna etiqueta nueva (sobrio=%s)',
    (sobrio) => {
      const { html: documento } = renderCorreo(correoEnvenenado(sobrio), TEMA, {
        url: `https://ejemplo.test/baja?u=1&c=MESSAGES&t=abc`,
      });

      const etiquetas = etiquetasDe(documento);
      for (const etiqueta of etiquetas) {
        expect(ETIQUETAS_PERMITIDAS.has(etiqueta)).toBe(true);
      }
      /**
       * Y NO SÓLO QUE LAS ETIQUETAS SEAN LAS PERMITIDAS: que **no haya ningún `<` más**.
       * Contar los `<` del documento y comprobar que son exactamente los que abren una
       * etiqueta de la lista es lo que convierte «no aparece `<script>`» en «no aparece
       * NADA que un cliente pueda leer como marcado», que es lo que afirma el §7.5.
       */
      expect((documento.match(/</g) ?? []).length).toBe(etiquetas.length);
      expect(documento).not.toContain('<script');
      expect(documento).toContain('&lt;script&gt;');
      // El `onerror` del veneno sigue ahí… como TEXTO, dentro de un `&lt;img&gt;` que
      // ningún cliente va a construir. Se lee, no se ejecuta: eso es escapar.
      expect(documento).toContain('&lt;img src=x onerror=alert(2)&gt;');
    },
  );

  /**
   * EL CAMPO QUE ESCRIBE UN ADMIN SE ESCAPA IGUAL (decisión asociada del §7.2).
   *
   * No porque el admin sea la amenaza, sino porque una cuenta de admin comprometida sí lo
   * es, y el escapado cuesta cero. Este test existe para que nadie «optimice» una
   * excepción: un serializador con excepciones es uno que alguien acabará usando mal.
   */
  it('no hay campo privilegiado: el cuerpo de un admin sale escapado como el resto', () => {
    const { html: documento } = renderCorreo(
      {
        to: 'a@b.test',
        subject: 'Respuesta',
        piezas: [{ tipo: 'parrafo', texto: '<b>negrita del admin</b>' }],
      },
      TEMA,
      null,
    );
    expect(documento).toContain('&lt;b&gt;negrita del admin&lt;/b&gt;');
    expect(documento).not.toContain('<b>');
  });

  it('una URL que no sea http(s) no llega a ningún href', () => {
    expect(urlSegura('https://x.test/a')).toBe('https://x.test/a');
    expect(urlSegura('http://x.test/a')).toBe('http://x.test/a');
    expect(urlSegura('javascript:alert(1)')).toBeNull();
    expect(urlSegura('data:text/html,<script>alert(1)</script>')).toBeNull();

    const { html: documento } = renderCorreo(
      {
        to: 'a@b.test',
        subject: 'x',
        piezas: [{ tipo: 'boton', etiqueta: 'Pulsa', url: 'javascript:alert(1)' }],
      },
      TEMA,
      null,
    );
    // El enlace degrada a texto legible en vez de tumbar el correo: sigue leyéndose a
    // dónde iba, y no hay `href` que pulsar.
    expect(documento).not.toContain('href="javascript:');
    expect(documento).toContain('javascript:alert(1)');
  });

  it('los saltos de línea se respetan sin que eso abra una puerta', () => {
    const { html: documento } = renderCorreo(
      {
        to: 'a@b.test',
        subject: 'x',
        piezas: [{ tipo: 'parrafo', texto: 'una\n<b>dos</b>' }],
      },
      TEMA,
      null,
    );
    expect(documento).toContain('una<br />&lt;b&gt;dos&lt;/b&gt;');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// BARRERA 3 — LAS DOS PARTES, Y EL PIE
// ═════════════════════════════════════════════════════════════════════════════════════

describe('B3 — doble parte y pie de baja', () => {
  it('renderCorreo devuelve SIEMPRE texto y html', () => {
    const { texto, html: documento } = renderCorreo(correoEnvenenado(), TEMA, null);
    expect(texto.length).toBeGreaterThan(0);
    expect(documento.length).toBeGreaterThan(0);
  });

  it('el texto conserva la forma de siempre: bloques, cita entrecomillada y enlace debajo', () => {
    expect(
      renderTexto(
        [
          { tipo: 'saludo', nombre: 'Ernest' },
          { tipo: 'parrafo', texto: 'Ha pasado algo.' },
          { tipo: 'cita', texto: 'lo que dijo el otro' },
          { tipo: 'boton', etiqueta: 'Verlo aquí', url: 'https://x.test/a' },
          { tipo: 'cierre', texto: 'No respondas a este correo.' },
        ],
        null,
      ),
    ).toBe(
      'Hola Ernest,\n\n' +
        'Ha pasado algo.\n\n' +
        '"lo que dijo el otro"\n\n' +
        'Verlo aquí:\nhttps://x.test/a\n\n' +
        'No respondas a este correo.',
    );
  });

  it('el pie de baja sale en LAS DOS partes, y con la URL intacta', () => {
    const url = 'https://x.test/baja?u=abc&c=MESSAGES&t=deadbeef';
    const { texto, html: documento } = renderCorreo(correoEnvenenado(), TEMA, { url });

    expect(texto).toContain('Si no quieres recibir estos avisos, date de baja aquí:');
    expect(texto).toContain(url);
    expect(documento).toContain('Si no quieres recibir estos avisos, date de baja aquí:');
    // En HTML el `&` de la query sale como entidad — que es lo correcto y lo que un
    // cliente vuelve a convertir en `&` al seguir el enlace.
    expect(documento).toContain('href="https://x.test/baja?u=abc&amp;c=MESSAGES&amp;t=deadbeef"');
  });

  it('sin pie (las críticas) no aparece por ninguna de las dos partes', () => {
    const { texto, html: documento } = renderCorreo(correoEnvenenado(), TEMA, null);
    expect(texto).not.toContain('date de baja');
    expect(documento).not.toContain('date de baja');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// BARRERA 4 — EL TEMA LLEGA AL CORREO (Y LA TIPOGRAFÍA NO)
// ═════════════════════════════════════════════════════════════════════════════════════

describe('B4 — el tema, en valores literales inline', () => {
  /**
   * EL ESPEJO DEL MODELO 0. El tema de emergencia no es una paleta paralela: son los
   * mismos tokens pasados por `tripleteAHex`. Si el Modelo 0 cambiara un color y esta
   * constante no, el correo de una instancia con la base caída se vería de otro color que
   * el de la instancia de al lado — el tipo de divergencia que nadie mira nunca.
   */
  it('el tema de fábrica ES el Modelo 0, no una copia a mano', () => {
    const tokens = resolverTokens(MODELO_POR_DEFECTO, MODELO_POR_DEFECTO.coloresPorDefecto);
    expect(temaCorreo(tokens, null)).toEqual(TEMA_CORREO_DE_FABRICA);
  });

  it('un modelo con otro color principal lo escribe inline, en hexadecimal', () => {
    const tokens = resolverTokens(MODELO_POR_DEFECTO, {
      ...MODELO_POR_DEFECTO.coloresPorDefecto,
      primary: '120 100% 25%',
    });
    const tema = temaCorreo(tokens, null);
    expect(tema.primary).toBe('#008000');

    const { html: documento } = renderCorreo(
      {
        to: 'a@b.test',
        subject: 'x',
        piezas: [{ tipo: 'boton', etiqueta: 'Ir', url: 'https://x.test/a' }],
      },
      tema,
      null,
    );
    // Inline y no en una variable CSS: en un correo no existen las variables.
    expect(documento).toContain('background-color:#008000');
    expect(documento).not.toContain('var(--');
    expect(documento).not.toContain('hsl(');
  });

  it('un token ilegible cae a su valor de fábrica, y sólo ése', () => {
    const tema = temaCorreo({ primary: 'esto no es un color', border: '0 0% 0%' }, null);
    expect(tema.primary).toBe(TEMA_CORREO_DE_FABRICA.primary);
    expect(tema.borde).toBe('#000000');
  });

  it('el logo público va a la cabecera; sin logo, no hay cabecera', () => {
    const conLogo = renderCorreo(
      { to: 'a@b.test', subject: 'x', piezas: [] },
      { ...TEMA, logoUrl: 'https://cdn.test/logo.png' },
      null,
    ).html;
    expect(conLogo).toContain('<img src="https://cdn.test/logo.png"');

    const sinLogo = renderCorreo({ to: 'a@b.test', subject: 'x', piezas: [] }, TEMA, null).html;
    expect(sinLogo).not.toContain('<img');
  });

  /**
   * LA PERSONALIDAD ES PARCIAL, Y ES LA CONTRAPARTIDA ACEPTADA (§7.3).
   *
   * No hay fuentes personalizadas fiables en correo: una `@font-face` la ignoran Gmail y
   * Outlook. Así que el eje tipográfico del modelo NO viaja y se cae a la pila del
   * sistema. Este test lo fija para que quede dicho en código y no sólo en un documento:
   * el día que alguien intente meter la tipografía del modelo, se encontrará con esto.
   */
  it('la tipografía del modelo NO viaja: pila del sistema, siempre', () => {
    const tokens = resolverTokens(MODELO_POR_DEFECTO, MODELO_POR_DEFECTO.coloresPorDefecto);
    const { html: documento } = renderCorreo(
      { to: 'a@b.test', subject: 'x', piezas: [{ tipo: 'parrafo', texto: 'hola' }] },
      temaCorreo(tokens, null),
      null,
    );
    expect(documento).toContain(`font-family:${PILA_TIPOGRAFICA}`);
    expect(documento).not.toContain('@font-face');
    expect(documento).not.toContain('fonts.googleapis');
  });

  /** SOBRIO: ni logo ni botón de color. El enlace, desnudo y entero. */
  it('un correo sobrio no lleva logo ni botón de marca', () => {
    const { html: documento } = renderCorreo(
      {
        to: 'a@b.test',
        subject: 'Restablece tu contraseña',
        sobrio: true,
        piezas: [{ tipo: 'boton', etiqueta: 'Restablecer', url: 'https://x.test/r?token=1' }],
      },
      { ...TEMA, logoUrl: 'https://cdn.test/logo.png' },
      null,
    );
    expect(documento).not.toContain('<img');
    expect(documento).not.toContain(`background-color:${TEMA.primary}`);
    expect(documento).toContain('https://x.test/r?token=1');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// BARRERA 5 — QUE LO PINTE UN CLIENTE DE CORREO DE VERDAD
// ═════════════════════════════════════════════════════════════════════════════════════

describe('B5 — compatibilidad con clientes de correo', () => {
  const documento = renderCorreo(correoEnvenenado(), { ...TEMA, logoUrl: 'https://c.test/l.png' }, {
    url: 'https://x.test/baja?u=1&c=MESSAGES&t=a',
  }).html;

  it('la estructura son TABLAS, no flexbox ni grid (Outlook usa el motor de Word)', () => {
    expect(documento).toContain('<table role="presentation"');
    expect(documento).not.toContain('display:flex');
    expect(documento).not.toContain('display:grid');
    expect(documento).not.toContain('position:absolute');
  });

  it('los estilos van INLINE: ni <style> en el head ni clases (Gmail los recorta)', () => {
    expect(documento).not.toContain('<style');
    expect(documento).not.toMatch(/\sclass=/);
    expect(documento).not.toContain('<link');
  });

  it('nada que un cliente no sepa pintar: sin SVG, sin imágenes de fondo, sin scripts', () => {
    expect(documento).not.toContain('<svg');
    expect(documento).not.toContain('background-image');
    expect(documento).not.toContain('<script');
  });

  /** Gmail recorta un correo alrededor de los 102 KB, y lo que recorta es el pie. */
  it('pesa muy por debajo del recorte de Gmail', () => {
    expect(Buffer.byteLength(documento, 'utf8')).toBeLessThan(100 * 1024);
  });

  it('lleva el doctype que pone a Outlook en modo estándar', () => {
    expect(documento.startsWith('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"')).toBe(
      true,
    );
  });
});
