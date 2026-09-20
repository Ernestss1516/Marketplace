import { createHash } from 'crypto';
import { deflateSync } from 'zlib';

/**
 * LA FOTO DE LA SEMILLA — la que hace que el LCP de /busqueda mida una IMAGEN.
 *
 * ── POR QUÉ HIZO FALTA INVENTARLA ───────────────────────────────────────────────────────
 *
 * `estado-tecnico.md` dejó anotado que el LCP de las dos filas de destacados **no se midió
 * de verdad**: «la semilla no trae imágenes, así que el elemento LCP fue un `<p>` de texto».
 * La frase se queda corta en un detalle que decide el diseño de esto: la batería SÍ sube
 * fotos —diecisiete specs lo hacen—, pero todas suben `fixtures/test-image.png`, que es un
 * **PNG de 1×1 píxel y 70 bytes**.
 *
 * Y un 1×1 no puede ser el elemento LCP ni queriendo. El tamaño que el estándar atribuye a
 * una imagen es `min(área intrínseca, área pintada)`: la tarjeta la estira a 242×242 CSS,
 * pero su área intrínseca es **1**. Cualquier párrafo de la página gana. O sea que el texto
 * no ganaba por falta de fotos: ganaba **aunque hubiera fotos**, y seguiría ganando aunque
 * alguien sembrara cien anuncios con la fixture de siempre.
 *
 * Por eso esto NO reutiliza `test-image.png` ni lo toca: ese fichero es el adecuado para lo
 * que hacen los otros specs (subir algo válido, rápido y barato) y engordarlo les costaría
 * tiempo a cambio de nada. La foto del LCP es otra cosa y vive aparte.
 *
 * ── DETERMINISTA, Y COMPROBADO — NO «generado al azar con semilla fija y ya» ────────────
 *
 * Los píxeles salen de un generador congruencial con semilla constante: misma entrada,
 * mismos bytes, en cualquier máquina y en cualquier corrida. Pero eso es una PROMESA, y una
 * promesa no es una barrera — así que el spec compara el sha-256 de los píxeles contra
 * `SHA256_PIXELES`. Si alguien toca el patrón, la medición no cambia en silencio: sale roja.
 *
 * Se firman los PÍXELES y no el fichero PNG a propósito: el contenedor lo cierra `zlib`, y
 * el tamaño exacto de un deflate puede moverse entre versiones de Node. Eso no cambiaría en
 * nada lo que el navegador pinta —y por tanto tampoco lo que el LCP mide—, así que firmarlo
 * habría metido un rojo ambiental de la peor clase: uno que sale al actualizar Node y que no
 * señala ningún defecto. Lo que tiene que ser igual son los píxeles.
 *
 * ── POR QUÉ SE GENERA EN VEZ DE COMMITEAR UN .png ───────────────────────────────────────
 *
 * Un binario de ~1 MB en el repositorio también sería determinista, pero quedaría ahí para
 * siempre y nadie podría leer de dónde salen sus píxeles. Generado, el patrón se lee, se
 * discute y se cambia a la vista de todos — y la firma de arriba impide cambiarlo sin
 * enterarse.
 *
 * ── EL PATRÓN: RUIDO SOBRE DEGRADADO, Y NO ES DECORACIÓN ────────────────────────────────
 *
 * Una imagen lisa (un degradado, un color plano) comprime a casi nada: `next/image` la
 * serviría igual de ligera a 256 px que a 1600, y entonces la MUTACIÓN de la barrera 3
 * —pedir la imagen enorme— no empeoraría nada medible y el instrumento parecería ciego
 * cuando el ciego sería el estímulo. El ruido es lo que hace que los bytes crezcan con la
 * resolución, que es como se comporta una foto de verdad.
 */

/**
 * Lado de la foto, en píxeles.
 *
 * 1800 y no 256 (lo justo para ganar el LCP en la tarjeta, que pinta ~231 CSS), por dos
 * razones distintas:
 *
 *  1. La foto tiene que ser MÁS GRANDE que lo que se pinta, porque la barrera 5 mide
 *     precisamente que el navegador pida el tamaño justo y no el grande. Con una foto de 256
 *     no habría tamaño grande que pedir y `GRID_MEDIA_SIZES` no se podría comprobar.
 *  2. La mutación de la barrera 3 —servir la foto SIN optimizar— sólo empeora el LCP de
 *     forma medible si el original pesa de verdad. A 1200 px de lado el original son ~1,5 MB;
 *     a 1800, ~3,3 MB. (Lo que de verdad hacía ciega aquella mutación no era el tamaño sino
 *     el ancho de banda infinito de `localhost` — eso se arregló acotando la red, ver
 *     `RED_DOMESTICA` en la spec. Esto sólo separa más la señal.)
 */
export const LADO = 1800;

/**
 * La firma de los píxeles. Si este número cambia, la semilla dejó de ser la misma y **la
 * medición del LCP ya no es comparable con la anterior**. Es la BARRERA 1.
 */
export const SHA256_PIXELES = 'fe3fa9528b126cdedf339f3c7e579a4cc0929e355ac69225e5cfc3f5ffffe6e5';

/** RGB en crudo, `LADO * LADO * 3` bytes, sin cabecera ni filtros. */
export function pixelesDeterministas(lado = LADO): Buffer {
  const pixeles = Buffer.allocUnsafe(lado * lado * 3);

  // Congruencial lineal (los mismos multiplicador/incremento que `glibc`), semilla fija.
  // Aritmética de 32 bits sin signo con `Math.imul` para que no dependa de dobles.
  // El ruido NO es por píxel, es por BLOQUE de 4×4, y va cuantizado a 16 niveles.
  //
  // Con ruido de píxel y 256 niveles el PNG se iba a 7 MB — cerca del tope de subida de la
  // API (10 MB) y ocho subidas de eso por corrida. Un grano más grueso comprime mucho mejor
  // y no le quita nada a lo que se necesita: que al pedir la imagen a 1200 px pesen bastante
  // más bytes que al pedirla a 256, que es lo que hace medible la mutación de la barrera 3.
  //
  // Se calcula A PARTIR DE LAS COORDENADAS DEL BLOQUE y no arrastrando un estado por el
  // bucle: así el valor de un píxel no depende del orden en que se recorra la imagen, y el
  // patrón es el mismo aunque alguien reescriba los bucles.
  const GRANO = 4;
  const ruido = (bx: number, by: number, canal: number) => {
    let estado = (0x5eed1cb ^ Math.imul(bx + 1, 0x9e3779b1) ^ Math.imul(by + 1, 0x85ebca6b)) >>> 0;
    for (let n = 0; n <= canal; n++) {
      estado = (Math.imul(estado, 1103515245) + 12345) >>> 0;
    }
    return (estado >>> 16) & 0xf0;
  };

  let i = 0;
  for (let y = 0; y < lado; y++) {
    const by = (y / GRANO) | 0;
    for (let x = 0; x < lado; x++) {
      const bx = (x / GRANO) | 0;
      // Degradado de fondo (estructura, para que no sea un televisor sin señal) + ruido
      // (entropía, para que el peso crezca con la resolución — ver la cabecera).
      const base = ((x * 255) / lado + (y * 255) / lado) / 2;
      pixeles[i++] = (base * 0.55 + ruido(bx, by, 0) * 0.45) & 0xff;
      pixeles[i++] = (((x ^ y) & 0xff) * 0.35 + ruido(bx, by, 1) * 0.65) & 0xff;
      pixeles[i++] = (base * 0.3 + ruido(bx, by, 2) * 0.7) & 0xff;
    }
  }
  return pixeles;
}

// ── PNG mínimo, a mano ────────────────────────────────────────────────────────────────────
// Sin dependencias: `sharp` vive en apps/api y arrastrarlo aquí por un fichero de prueba
// sería añadir un binario nativo al paquete del frontend. Un PNG sin filtros es una cabecera,
// un deflate y un CRC — cabe en veinte líneas y no puede sorprender a nadie.

const TABLA_CRC = (() => {
  const tabla = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c;
  }
  return tabla;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function trozo(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length, 0);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo), 0);
  return Buffer.concat([largo, cuerpo, crc]);
}

function aPng(pixeles: Buffer, lado: number): Buffer {
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(lado, 0);
  cabecera.writeUInt32BE(lado, 4);
  cabecera[8] = 8; // 8 bits por canal
  cabecera[9] = 2; // color truecolor (RGB)

  // Una línea de filtro por fila, siempre 0 («None»): el filtrado es una optimización de
  // compresión y aquí se busca lo contrario (ver el porqué del ruido).
  const bytesPorFila = lado * 3;
  const crudo = Buffer.allocUnsafe(lado * (bytesPorFila + 1));
  for (let y = 0; y < lado; y++) {
    crudo[y * (bytesPorFila + 1)] = 0;
    pixeles.copy(crudo, y * (bytesPorFila + 1) + 1, y * bytesPorFila, (y + 1) * bytesPorFila);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', cabecera),
    trozo('IDAT', deflateSync(crudo, { level: 6 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

let memo: Buffer | undefined;

/**
 * El PNG de la semilla. Se calcula una vez por proceso: generar 1600×1600 y comprimirlo
 * cuesta ~1 s, y el `beforeAll` lo pide ocho veces.
 */
export function fotoDeterminista(): Buffer {
  if (!memo) memo = aPng(pixelesDeterministas(LADO), LADO);
  return memo;
}

/** El sha-256 de los píxeles — lo que la BARRERA 1 compara contra `SHA256_PIXELES`. */
export function firmaDeLosPixeles(): string {
  return createHash('sha256').update(pixelesDeterministas(LADO)).digest('hex');
}
