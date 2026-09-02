import { BadRequestException, ValidationError } from '@nestjs/common';

/**
 * i18n T5 — LOS MENSAJES DE `class-validator`, EN ESPAÑOL, EN UN SOLO SITIO.
 *
 * ── EL DEFECTO ───────────────────────────────────────────────────────────────────────────
 *
 * `main.ts` montaba el `ValidationPipe` sin `exceptionFactory`, así que de 162 DTOs **sólo
 * 11** decían algo en español y el resto usaba los textos de fábrica de `class-validator`:
 * *«title should not be empty»*, *«price must not be less than 0»*. Mismo reparto que el
 * resto del backend: el público no los ve (`toUserMessage` devuelve un genérico), **el
 * backoffice sí** — `client.ts` hace `String(body.message)` y, cuando `message` es el array
 * de `class-validator`, el admin lee una lista de frases inglesas separadas por comas.
 *
 * ── POR QUÉ AQUÍ Y NO EN LOS 162 DTOs ───────────────────────────────────────────────────
 *
 * Poner `message:` en cada decorador son 162 sitios que hay que acordarse de rellenar, y el
 * DTO nº 163 nacería otra vez en inglés sin que nada lo notara. Traducir en el pipe **cierra
 * la clase**: un DTO nuevo hereda el español por el mero hecho de existir. Es el mismo
 * criterio de la barrera B5 de T3 (un solo lector) y el mismo movimiento que hizo `T3` con
 * el vocabulario del frontend.
 *
 * ── SE TRADUCE POR REGLA, NO POR TEXTO ──────────────────────────────────────────────────
 *
 * `class-validator` entrega `constraints` como `{ nombreDeLaRegla: mensajeEnInglés }`
 * (verificado: `{ isNotEmpty: 'title should not be empty', maxLength: 'title must be shorter
 * than or equal to 120 characters' }`). Se usa **el nombre de la regla**, que es estable,
 * y no el texto, que cambia entre versiones de la librería.
 *
 * El precio de esa decisión: los ARGUMENTOS (el 120, el 0) sólo viven dentro del texto
 * inglés, así que se extraen con una expresión regular **específica de cada regla**. Un
 * `\d+` genérico sobre el mensaje entero cazaría un número que estuviera en el nombre del
 * campo (`precio2`, `nivel3`), y ahí el mensaje mentiría en vez de fallar. Si la extracción
 * no encuentra el número, la frase se emite sin él —incompleta pero cierta— en vez de
 * inventarlo.
 *
 * ── LA REGLA DESCONOCIDA SE DEJA PASAR TAL CUAL, Y ES DELIBERADO ────────────────────────
 *
 * Lo que no está en el diccionario devuelve **su mensaje original**. Dos motivos:
 *
 *  1. Los validadores propios del proyecto (`IsSafeContentUrl`, `IsOwnStorageUrl`,
 *     `IsFiscalTaxId`, `IsValidVideoId`, `IsTableRows`) **ya escriben en español** en su
 *     `defaultMessage()`. Traducirlos otra vez sería pisar un texto mejor que el genérico.
 *  2. Una regla de `class-validator` que nadie ha mapeado degrada a lo que hay hoy —inglés—
 *     en vez de desaparecer o de volverse un «campo no válido» que no dice nada. Fail-open
 *     en el TEXTO, nunca en la validación: el rechazo se produce igual.
 */

/** Extrae el primer número que aparece DESPUÉS de un anclaje concreto del mensaje inglés. */
function argumento(mensaje: string, anclaje: RegExp): string | null {
  const m = mensaje.match(anclaje);
  return m?.[1] ?? null;
}

/**
 * «… y si no se pudo leer el número, la frase se queda sin él» — nunca se inventa.
 *
 * El `filter(Boolean)` no es adorno: los límites numéricos (`min`, `max`) no llevan sufijo,
 * y concatenar a pelo dejaba un espacio final en un mensaje que se le enseña a una persona.
 */
function conLimite(base: string, limite: string | null, sufijo = ''): string {
  if (limite === null) return base;
  return [base, limite, sufijo].filter(Boolean).join(' ');
}

/**
 * Los valores admitidos de un `@IsEnum`/`@IsIn`, tal y como los lista el mensaje inglés
 * («must be one of the following values: A, B, C»). Se reutilizan sin traducir: son valores
 * del contrato de la API, no texto para leer.
 */
function valoresAdmitidos(mensaje: string): string | null {
  return argumento(mensaje, /one of the following values:\s*(.+)$/);
}

/**
 * Cada regla trae DOS cosas, y la primera es la que evita el defecto que costó una regresión.
 *
 * `deFabrica` reconoce el texto POR OMISIÓN de `class-validator` para esa regla. Si el
 * mensaje no lo casa, **es de alguien** —un `@IsDefined({ message: '…' })` escrito a mano en
 * un DTO, o el `defaultMessage()` de un validador propio— y se deja intacto.
 *
 * SE APRENDIÓ ROMPIÉNDOLO: sin esta comprobación, la traducción pisaba los 11 DTOs que ya
 * decían algo mejor en español. `homepage.e2e-spec.ts` lo cazó — «Cada tarjeta de la rejilla
 * necesita una imagen o un icono.» se convertía en «"blocks.0.items.0.media" es obligatorio»,
 * que es correcto, genérico y peor. Traducir nunca puede EMPEORAR un mensaje que ya estaba
 * escrito para quien lo lee.
 */
type Regla = {
  deFabrica: RegExp;
  traducir: (campo: string, mensajeIngles: string) => string;
};

const REGLAS: Record<string, Regla> = {
  // ── Presencia ──────────────────────────────────────────────────────────────
  isNotEmpty: { deFabrica: /should not be empty$/, traducir: (c) => `«${c}» no puede estar vacío` },
  isDefined: { deFabrica: /should not be null or undefined$/, traducir: (c) => `«${c}» es obligatorio` },
  // La produce `forbidNonWhitelisted: true`. No es un campo mal puesto: es un campo que
  // sobra, y decirlo así ahorra el «pero si lo estoy mandando bien».
  whitelistValidation: { deFabrica: /should not exist$/, traducir: (c) => `«${c}» no es un campo admitido` },

  // ── Tipos ──────────────────────────────────────────────────────────────────
  isString: { deFabrica: /must be a string$/, traducir: (c) => `«${c}» tiene que ser texto` },
  isInt: { deFabrica: /must be an integer number$/, traducir: (c) => `«${c}» tiene que ser un número entero` },
  isNumber: { deFabrica: /must be a number/, traducir: (c) => `«${c}» tiene que ser un número` },
  isBoolean: { deFabrica: /must be a boolean value$/, traducir: (c) => `«${c}» tiene que ser verdadero o falso` },
  isArray: { deFabrica: /must be an array$/, traducir: (c) => `«${c}» tiene que ser una lista` },
  isObject: { deFabrica: /must be an object$/, traducir: (c) => `«${c}» tiene que ser un objeto` },
  isEmail: { deFabrica: /must be an email$/, traducir: (c) => `«${c}» tiene que ser un correo electrónico válido` },
  isUrl: { deFabrica: /must be a URL address$/, traducir: (c) => `«${c}» tiene que ser una URL válida` },
  isUUID: { deFabrica: /must be a UUID$/, traducir: (c) => `«${c}» tiene que ser un identificador válido` },
  isDateString: {
    deFabrica: /must be a valid ISO 8601 date string$/,
    traducir: (c) => `«${c}» tiene que ser una fecha válida`,
  },
  isIso8601: {
    deFabrica: /must be a valid ISO 8601 date string$/,
    traducir: (c) => `«${c}» tiene que ser una fecha válida`,
  },
  isNumberString: { deFabrica: /must be a number string$/, traducir: (c) => `«${c}» tiene que ser un número` },

  // ── Rangos numéricos ───────────────────────────────────────────────────────
  min: {
    deFabrica: /must not be less than -?\d/,
    traducir: (c, m) =>
      conLimite(`«${c}» no puede ser menor que`, argumento(m, /not be less than (-?\d+(?:\.\d+)?)/)),
  },
  max: {
    deFabrica: /must not be greater than -?\d/,
    traducir: (c, m) =>
      conLimite(`«${c}» no puede ser mayor que`, argumento(m, /not be greater than (-?\d+(?:\.\d+)?)/)),
  },
  isPositive: { deFabrica: /must be a positive number$/, traducir: (c) => `«${c}» tiene que ser mayor que cero` },

  // ── Longitudes ─────────────────────────────────────────────────────────────
  maxLength: {
    deFabrica: /must be shorter than or equal to \d+ characters$/,
    traducir: (c, m) =>
      conLimite(`«${c}» no puede tener más de`, argumento(m, /equal to (\d+) characters/), 'caracteres'),
  },
  minLength: {
    deFabrica: /must be longer than or equal to \d+ characters$/,
    traducir: (c, m) =>
      conLimite(`«${c}» tiene que tener al menos`, argumento(m, /equal to (\d+) characters/), 'caracteres'),
  },
  arrayMaxSize: {
    deFabrica: /must contain no more than \d+ elements$/,
    traducir: (c, m) =>
      conLimite(`«${c}» no puede tener más de`, argumento(m, /no more than (\d+) elements/), 'elementos'),
  },
  arrayMinSize: {
    deFabrica: /must contain at least \d+ elements$/,
    traducir: (c, m) =>
      conLimite(`«${c}» tiene que tener al menos`, argumento(m, /at least (\d+) elements/), 'elementos'),
  },

  // ── Conjuntos cerrados ─────────────────────────────────────────────────────
  isEnum: {
    deFabrica: /must be one of the following values:/,
    traducir: (c, m) => `«${c}» tiene que ser uno de estos valores: ${valoresAdmitidos(m)}`,
  },
  isIn: {
    deFabrica: /must be one of the following values:/,
    traducir: (c, m) => `«${c}» tiene que ser uno de estos valores: ${valoresAdmitidos(m)}`,
  },
};

/**
 * Aplana el árbol de errores a una lista de frases.
 *
 * `@ValidateNested` (25 usos) produce errores ANIDADOS, y el `property` de cada hijo es
 * relativo: sin recorrer los hijos, un fallo dentro de un bloque de la portada saldría como
 * «blocks no es válido» sin decir cuál ni por qué. El camino se compone con puntos
 * (`blocks.0.title`), que es como lo escribe quien manda la petición.
 */
export function traducirErroresDeValidacion(errores: ValidationError[], prefijo = ''): string[] {
  return errores.flatMap((error) => {
    const campo = prefijo ? `${prefijo}.${error.property}` : String(error.property);

    const propios = Object.entries(error.constraints ?? {}).map(([nombre, mensaje]) => {
      const regla = REGLAS[nombre];
      // DOS puertas, y las dos dejan pasar el mensaje original:
      //   · no hay regla para ese nombre  → validador propio o regla nueva sin mapear;
      //   · el texto no es el de fábrica  → alguien lo escribió a mano en el DTO.
      // Sólo se traduce lo que es demostrablemente el inglés por omisión.
      if (!regla || !regla.deFabrica.test(mensaje)) return mensaje;
      return regla.traducir(campo, mensaje);
    });

    const hijos = error.children?.length ? traducirErroresDeValidacion(error.children, campo) : [];
    return [...propios, ...hijos];
  });
}

/**
 * La fábrica que se le pasa al `ValidationPipe`.
 *
 * Devuelve un `BadRequestException` con `message` como ARRAY, exactamente la misma forma que
 * produce Nest por omisión: el frontend hace `String(body.message)` y depende de que lo siga
 * siendo. Lo único que cambia es el idioma de las frases.
 */
export function fabricaDeErroresDeValidacion(errores: ValidationError[]): BadRequestException {
  return new BadRequestException(traducirErroresDeValidacion(errores));
}
