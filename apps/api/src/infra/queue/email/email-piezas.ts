/**
 * E8 — LAS PIEZAS DE UN CORREO. Fichero de TIPOS, sin una sola línea de lógica.
 *
 * ── LA INVERSIÓN, Y POR QUÉ ESTE FICHERO NO TIENE CÓDIGO ────────────────────────────
 *
 * Hasta E8, los dieciocho métodos del `NotificationProcessor` **componían la cadena** y
 * `enviar()` sólo la despachaba. La forma ingenua de meter HTML habría sido añadir un
 * campo `html` a `enviar()` y que cada método compusiera también su marcado: eso convierte
 * una invariante en **dieciocho ocasiones de olvidarla**, que es exactamente el defecto de
 * clase que este processor lleva evitando desde el pie de baja.
 *
 * Así que se invierte quién compone: **los dieciocho métodos dejan de componer nada.**
 * Entregan esto —datos estructurados— y `enviar()` es el único que construye el correo,
 * texto y HTML.
 *
 * ── LA GARANTÍA ES DE TIPOS, NO DE DISCIPLINA ───────────────────────────────────────
 *
 * **No existe ninguna pieza que acepte HTML.** Un método que quisiera inyectar marcado no
 * tendría dónde ponerlo: el tipo no lo admite. No hay campo `html`, ni `raw`, ni
 * `contenidoHtml`, y `correo.spec.ts` lo comprueba de dos maneras —leyendo este fichero y
 * con un `@ts-expect-error` que deja de compilar el día que alguien añada uno—.
 *
 * Todos los campos de texto son **texto plano**, y en el único punto donde el texto se
 * convierte en HTML —el serializador de `email-render.ts`— **se escapan todos, siempre**.
 * El serializador no distingue campos «confiables» de «no confiables»: los trata igual.
 * Un serializador con excepciones es un serializador que alguien acabará usando mal.
 *
 * Ver `docs/diseno-sistema-estilo.md` §7.2.
 */

/**
 * Una pieza de correo. La unión completa: si hace falta una forma nueva se añade aquí y se
 * le da render en LOS DOS lados (`renderTexto` y `renderHtml`), que es un `switch`
 * exhaustivo — una pieza sin render no compila.
 */
export type PiezaCorreo =
  /** «Hola Ernest,». El nombre lo escribe el usuario al registrarse. */
  | { readonly tipo: 'saludo'; readonly nombre: string }
  /** Un párrafo del cuerpo. Los saltos de línea se respetan en los dos renders. */
  | { readonly tipo: 'parrafo'; readonly texto: string }
  /**
   * Una CITA: el extracto de un ticket, de un mensaje, de un mensaje de contacto. Es el
   * campo más expuesto del sistema —lo escribe un desconocido y lo lee un agente con
   * sesión— y por eso tiene pieza propia: se ve de un vistazo dónde entra contenido ajeno.
   */
  | { readonly tipo: 'cita'; readonly texto: string }
  /**
   * La acción. `etiqueta` es lo que se lee («Verlo aquí»), `url` a dónde va.
   *
   * En texto sale como «etiqueta:\nURL», que es literalmente lo que estos correos ya
   * hacían. En HTML sale como botón —y **con la URL escrita debajo**: un correo cuyo
   * destino no se puede leer es un correo que enseña a hacer clic a ciegas.
   */
  | { readonly tipo: 'boton'; readonly etiqueta: string; readonly url: string }
  /** Un dato que conviene que no se pierda entre los párrafos («no se te ha cobrado»). */
  | { readonly tipo: 'aviso'; readonly texto: string }
  /** El cierre: «no respondas a este correo», «es totalmente opcional». */
  | { readonly tipo: 'cierre'; readonly texto: string };

/**
 * Un correo entero, tal y como lo entrega un método de envío.
 *
 * NO LLEVA `from`: lo pone `enviar()` con el remitente configurado. Iba de adorno en los
 * dieciocho —se pasaba `from: this.from` y `enviar()` lo ignoraba— y un parámetro que no
 * hace nada es un parámetro que alguien creerá que sí hace algo.
 */
export interface CorreoEstructurado {
  readonly to: string;
  readonly subject: string;
  readonly piezas: readonly PiezaCorreo[];
  /**
   * SOBRIO = sin logo y sin botón de color (§7.4.2 del diseño).
   *
   * Verificación de cuenta, restablecimiento de contraseña y decisiones sobre la cuenta.
   * **Un correo de restablecimiento muy adornado se parece a una suplantación**, y ahí la
   * marca juega en contra: cuanto más se parece a un correo de sistema y menos a una
   * campaña, más creíble es. En su lugar el enlace se escribe entero y a la vista.
   */
  readonly sobrio?: boolean;
}
