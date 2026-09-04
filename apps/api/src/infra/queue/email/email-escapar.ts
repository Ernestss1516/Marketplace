/**
 * E8 — EL ESCAPADO, Y LA PLANTILLA QUE NO DEJA SALTÁRSELO. Fichero PURO, sin DI.
 *
 * ── EL PROBLEMA QUE RESUELVE ────────────────────────────────────────────────────────
 *
 * «Acuérdate de escapar» es una regla de disciplina, y las reglas de disciplina se
 * incumplen en la línea 400 de un fichero que alguien edita con prisa. El §7.2 del diseño
 * pide algo más fuerte: **que no se pueda expresar HTML sin escapar**.
 *
 * La forma de conseguirlo en TypeScript es una plantilla etiquetada con un tipo marcado:
 *
 *   · `html\`...\`` devuelve un `HtmlSeguro`, y es **la única manera de fabricar uno**.
 *   · Todo lo que se interpola dentro de `html\`...\`` **se escapa**, salvo que ya sea un
 *     `HtmlSeguro` (o sea, que ya salió de otra plantilla de aquí).
 *   · No se exporta ninguna vía para marcar una cadena arbitraria como segura. No hay
 *     `crudo()`, no hay `noEscapar()`. Componer trozos se hace anidando plantillas.
 *
 * Consecuencia: una cadena de texto —venga del usuario, del admin o de una constante—
 * SÓLO puede llegar al HTML escapada. No porque el que escribe se acuerde, sino porque el
 * tipo no ofrece otra puerta. Es la misma propiedad que hace que el pie de baja no se
 * pueda olvidar: no hay más que un sitio por el que pasar.
 *
 * ── Y POR QUÉ TAMBIÉN SE ESCAPA LO QUE ESCRIBE UN ADMIN ─────────────────────────────
 *
 * `cuerpo` y `motivo` los escribe un administrador, no un desconocido. Se escapan igual.
 * No porque el admin sea la amenaza, sino porque **una cuenta de admin comprometida sí lo
 * es**, y el escapado cuesta cero. Un serializador con excepciones es un serializador que
 * alguien acabará usando mal — y el día que se use mal, el fallo no se ve: el correo sale
 * perfecto.
 */

/** Marca de nominalidad. No se exporta: sin ella nadie de fuera puede construir el tipo. */
declare const YA_ESCAPADO: unique symbol;

/** Un fragmento de HTML ya serializado. Sólo lo produce `html\`...\``. */
export interface HtmlSeguro {
  readonly [YA_ESCAPADO]: true;
  readonly valor: string;
}

/**
 * Los cinco caracteres, y los cinco importan.
 *
 * `<` y `>` cierran y abren etiquetas; `&` puede empezar una entidad y hay que escaparlo
 * PRIMERO o se escaparían las que acabamos de crear; `"` y `'` cierran un valor de
 * atributo, que es por donde se cuela un `onerror=` en un `<img>` o un destino falso en un
 * `href`. Escapar sólo los tres primeros es el error clásico: seguro en el cuerpo, roto en
 * los atributos — y aquí hay atributos (`href`, `alt`, `title`).
 */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Interpolable = string | number | HtmlSeguro | readonly HtmlSeguro[];

function esSeguro(v: Interpolable): v is HtmlSeguro {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'valor' in v;
}

/**
 * La plantilla. `html\`<p>${textoDelUsuario}</p>\`` escapa el texto y no hay forma de
 * pedirle que no lo haga.
 *
 * Acepta números sin escapar (un número no puede contener marcado) y listas de
 * `HtmlSeguro` para componer sin un `join` que rompa el tipo.
 */
export function html(
  trozos: TemplateStringsArray,
  ...valores: readonly Interpolable[]
): HtmlSeguro {
  let salida = trozos[0];
  for (let i = 0; i < valores.length; i++) {
    const v = valores[i];
    if (Array.isArray(v)) salida += (v as readonly HtmlSeguro[]).map((h) => h.valor).join('');
    else if (esSeguro(v as Interpolable)) salida += (v as HtmlSeguro).valor;
    else if (typeof v === 'number') salida += String(v);
    else salida += escaparHtml(v as string);
    salida += trozos[i + 1];
  }
  return { valor: salida } as HtmlSeguro;
}

/** Une fragmentos ya seguros con un separador seguro. */
export function unir(partes: readonly HtmlSeguro[], separador: HtmlSeguro): HtmlSeguro {
  return html`${partes.flatMap((p, i) => (i === 0 ? [p] : [separador, p]))}`;
}

/** El texto final que se manda. Único punto donde un `HtmlSeguro` vuelve a ser `string`. */
export function serializar(h: HtmlSeguro): string {
  return h.valor;
}

/**
 * UNA URL QUE SE PUEDE PONER EN UN `href`, o `null`.
 *
 * El escapado impide inyectar una etiqueta, pero **no** impide que un `href` apunte a
 * `javascript:` o a `data:text/html`. Hoy todas las URL de estos correos las compone el
 * propio processor a partir de `appUrl`, así que ninguna podría serlo; esto es la red por
 * si mañana una llega de otro sitio, y cuesta una expresión regular.
 *
 * Devuelve `null` en vez de lanzar: un enlace raro degrada a texto sin enlace —se sigue
 * leyendo— en vez de tumbar un correo que puede ser el único aviso de una sanción.
 */
export function urlSegura(url: string): string | null {
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}
