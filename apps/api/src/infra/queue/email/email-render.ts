/**
 * E8 — EL SERIALIZADOR. **El único sitio de todo el proyecto que convierte texto en HTML.**
 *
 * ── DÓNDE SE TRASLADÓ LA INVARIANTE ─────────────────────────────────────────────────
 *
 * Hasta E8 la regla era «este processor manda `text:`, nunca `html:`» — absoluta, y por
 * eso el §7 tuvo que subirla a decisión de Ernest. La regla nueva no es más laxa, es más
 * concreta: **el HTML se compone en un solo sitio, y todo dato entra escapado, siempre.**
 * Este fichero es ese sitio.
 *
 * Lo que lo sostiene no es este comentario: es que aquí no se concatenan cadenas. Todo el
 * marcado sale de la plantilla `html\`...\`` de `email-escapar.ts`, que escapa cuanto se
 * interpole y no ofrece ninguna puerta para no hacerlo. Un campo de una pieza no puede
 * llegar al correo sin pasar por ahí.
 *
 * ── LAS DOS PARTES, Y NINGUNA ES UN RESPALDO ────────────────────────────────────────
 *
 * `renderCorreo` devuelve SIEMPRE las dos: `texto` y `html`. La parte de texto no es el
 * plan B del HTML —es la mitad del correo (§7.4.1)—: cuenta para la entregabilidad, es lo
 * que leen los lectores de pantalla y los clientes que no pintan HTML, y es lo que se ve
 * cuando alguien reenvía el correo en modo texto. Un correo sólo-HTML es un fallo de test.
 *
 * ── EL HTML QUE SE ESCRIBE, Y POR QUÉ ES DE 2003 ────────────────────────────────────
 *
 *  · **Tablas** para toda la estructura. Sin flexbox ni grid: Outlook de escritorio en
 *    Windows pinta con el motor de Word, que no los conoce.
 *  · **Estilos inline**, nunca `<style>` en el `<head>`: Gmail lo recorta de forma
 *    inconsistente y lo que se pierde es la mitad del diseño.
 *  · **Sin `class`**, por lo mismo: sin hoja de estilos no seleccionan nada.
 *  · Sin imágenes de fondo, sin SVG y sin depender de `border-radius`: lo que un cliente
 *    ignore tiene que degradar a algo legible, no a algo roto.
 *  · Peso muy por debajo de los ~102 KB a los que Gmail recorta un correo (aquí son
 *    unos 4 KB).
 *
 * Ver `docs/diseno-sistema-estilo.md` §7.3.
 */
import { html, serializar, unir, urlSegura, type HtmlSeguro } from './email-escapar';
import type { CorreoEstructurado, PiezaCorreo } from './email-piezas';
import { PILA_TIPOGRAFICA, type TemaCorreo } from './email-tema';

/** El pie de baja, ya resuelto por el processor. `null` en las críticas. */
export type PieDeBaja = { readonly url: string } | null;

const TEXTO_PIE_1 = 'Si no quieres recibir estos avisos, date de baja aquí:';

// ─────────────────────────────────────────────────────────────────────────────────────
// LA PARTE DE TEXTO
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Las piezas, en texto plano.
 *
 * EL RESULTADO ES EL QUE ESTOS CORREOS YA TENÍAN, línea por línea: bloques separados por
 * una línea en blanco, la cita entre comillas, el botón como «etiqueta:» y la URL debajo.
 * La inversión de E8 cambia QUIÉN compone, no lo que le llega al usuario que lee en texto.
 */
export function renderTexto(piezas: readonly PiezaCorreo[], pie: PieDeBaja): string {
  const bloques = piezas.map((p): string => {
    switch (p.tipo) {
      case 'saludo':
        return `Hola ${p.nombre},`;
      case 'parrafo':
      case 'aviso':
      case 'cierre':
        return p.texto;
      case 'cita':
        return `"${p.texto}"`;
      case 'boton':
        return `${p.etiqueta}:\n${p.url}`;
    }
  });

  const cuerpo = bloques.join('\n\n');
  return pie ? `${cuerpo}\n\n—\n${TEXTO_PIE_1}\n${pie.url}` : cuerpo;
}

// ─────────────────────────────────────────────────────────────────────────────────────
// LA PARTE DE HTML
// ─────────────────────────────────────────────────────────────────────────────────────

/** Los saltos de línea de un párrafo, respetados. Se escapa ANTES; `<br />` lo pone la plantilla. */
function multilinea(texto: string): HtmlSeguro {
  return unir(
    texto.split('\n').map((linea) => html`${linea}`),
    html`<br />`,
  );
}

function fuente(tema: TemaCorreo, tam: number, color: string): HtmlSeguro {
  return html`font-family:${PILA_TIPOGRAFICA};font-size:${tam}px;line-height:1.6;color:${color};`;
}

/**
 * Una pieza, en HTML. `switch` EXHAUSTIVO sobre la unión: añadir una pieza y no darle
 * render aquí no compila, que es lo que impide que una forma nueva salga en texto y
 * desaparezca del correo bonito sin que nadie se entere.
 */
function piezaHtml(p: PiezaCorreo, tema: TemaCorreo, sobrio: boolean): HtmlSeguro {
  const base = fuente(tema, 15, tema.texto);

  switch (p.tipo) {
    case 'saludo':
      return html`<div style="${base}margin:0 0 4px;">Hola ${p.nombre},</div>`;

    case 'parrafo':
      return html`<div style="${base}">${multilinea(p.texto)}</div>`;

    case 'cierre':
      return html`<div style="${fuente(tema, 13, tema.textoSuave)}">
        ${multilinea(p.texto)}
      </div>`;

    /**
     * La cita: el extracto de un ticket, de un mensaje, de un contacto. El campo más
     * expuesto del sistema, y por eso se pinta con una marca que dice «esto lo escribió
     * otra persona» — un filete a la izquierda y color atenuado. Que se distinga de la voz
     * de la plataforma no es decoración: es lo que evita que un mensaje ajeno se lea como
     * un aviso oficial.
     */
    case 'cita':
      return html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="border-left:3px solid ${tema.borde};padding:2px 0 2px 14px;${fuente(
          tema,
          15,
          tema.textoSuave,
        )}">«${multilinea(p.texto)}»</td>
      </tr></table>`;

    case 'aviso':
      return html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td bgcolor="${tema.fondo}" style="background-color:${tema.fondo};border:1px solid ${
          tema.borde
        };padding:12px 16px;${base}">${multilinea(p.texto)}</td>
      </tr></table>`;

    case 'boton':
      return botonHtml(p.etiqueta, p.url, tema, sobrio);
  }
}

/**
 * EL BOTÓN, Y LA URL SIEMPRE ESCRITA DEBAJO.
 *
 * Un correo cuyo destino no se puede leer es un correo que enseña a hacer clic a ciegas, y
 * eso es exactamente lo que explota el phishing. Así que el destino se escribe entero,
 * siempre, en los dos modos.
 *
 * EN MODO SOBRIO NO HAY BOTÓN DE COLOR (§7.4.2): verificación, restablecimiento y
 * sanciones salen con el enlace desnudo. Un correo de restablecimiento muy adornado se
 * parece a una suplantación, y ahí la marca juega en contra.
 *
 * Si la URL no es `http(s)` no se pone `href` — se deja el texto. Un enlace raro degrada a
 * algo legible en vez de tumbar el aviso.
 */
function botonHtml(
  etiqueta: string,
  url: string,
  tema: TemaCorreo,
  sobrio: boolean,
): HtmlSeguro {
  const segura = urlSegura(url);
  const enlaceDesnudo = segura
    ? html`<a href="${segura}" style="color:${tema.primary};text-decoration:underline;word-break:break-all;">${url}</a>`
    : html`${url}`;
  const urlDebajo = html`<div style="${fuente(tema, 12, tema.textoSuave)}margin-top:${
    sobrio ? 4 : 12
  }px;word-break:break-all;">${enlaceDesnudo}</div>`;

  if (sobrio || !segura) {
    return html`<div>
      <div style="${fuente(tema, 15, tema.texto)}">${etiqueta}:</div>
      ${urlDebajo}
    </div>`;
  }

  return html`<div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td bgcolor="${tema.primary}" style="background-color:${tema.primary};border-radius:6px;">
        <a href="${segura}" style="display:inline-block;padding:12px 26px;font-family:${PILA_TIPOGRAFICA};font-size:15px;font-weight:bold;color:${tema.primaryTexto};text-decoration:none;">${etiqueta}</a>
      </td>
    </tr></table>
    ${urlDebajo}
  </div>`;
}

function cabeceraHtml(tema: TemaCorreo): HtmlSeguro | null {
  const logo = tema.logoUrl ? urlSegura(tema.logoUrl) : null;
  if (!logo) return null;
  // `alt` vacío A PROPÓSITO: el logo es decorativo aquí —lo que el correo dice está en el
  // texto— y un `alt` con el nombre de la instancia dejaría, en los clientes que bloquean
  // imágenes (que son casi todos por defecto), un trozo de texto suelto arriba del todo.
  return html`<tr><td style="padding:28px 32px 0;">
    <img src="${logo}" alt="" height="36" style="display:block;border:0;height:36px;max-height:36px;width:auto;" />
  </td></tr>`;
}

function pieHtml(tema: TemaCorreo, pie: PieDeBaja): HtmlSeguro | null {
  if (!pie) return null;
  const segura = urlSegura(pie.url);
  const enlace = segura
    ? html`<a href="${segura}" style="color:${tema.textoSuave};text-decoration:underline;word-break:break-all;">${pie.url}</a>`
    : html`${pie.url}`;
  return html`<tr><td style="border-top:1px solid ${tema.borde};padding:16px 32px 24px;${fuente(
    tema,
    12,
    tema.textoSuave,
  )}">${TEXTO_PIE_1}<br />${enlace}</td></tr>`;
}

/**
 * El correo entero.
 *
 * `<!DOCTYPE ... XHTML 1.0 Transitional>` y no HTML5: es el que hace que Outlook aplique
 * el modo estándar del motor de Word en vez del modo compatibilidad, donde los `padding`
 * de las celdas se comportan de otra manera.
 */
function renderHtml(correo: CorreoEstructurado, tema: TemaCorreo, pie: PieDeBaja): string {
  const sobrio = correo.sobrio === true;
  const cabecera = sobrio ? null : cabeceraHtml(tema);

  const filas = correo.piezas.map(
    (p) => html`<tr><td style="padding-bottom:16px;">${piezaHtml(p, tema, sobrio)}</td></tr>`,
  );

  const documento = html`<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${correo.subject}</title>
</head>
<body style="margin:0;padding:0;background-color:${tema.fondo};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${tema.fondo};"><tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background-color:${tema.panel};border:1px solid ${tema.borde};border-radius:8px;">
${cabecera ?? html``}
<tr><td style="padding:28px 32px 4px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${filas}</table>
</td></tr>
${pieHtml(tema, pie) ?? html``}
</table>
</td>
</tr></table>
</body>
</html>`;

  return serializar(documento);
}

/**
 * LAS DOS PARTES DE UN CORREO, y la única función que el processor llama.
 *
 * Que devuelva las dos juntas —en vez de dos funciones que haya que acordarse de llamar—
 * es lo que hace imposible mandar un correo sólo-HTML: no existe la forma de pedir una
 * sola. Mismo movimiento que el pie de baja y que `enviar()`.
 */
export function renderCorreo(
  correo: CorreoEstructurado,
  tema: TemaCorreo,
  pie: PieDeBaja,
): { texto: string; html: string } {
  return {
    texto: renderTexto(correo.piezas, pie),
    html: renderHtml(correo, tema, pie),
  };
}
