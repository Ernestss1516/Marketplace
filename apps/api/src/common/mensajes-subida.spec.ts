import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  IMAGEN_TIPO_NO_ADMITIDO,
  SIN_FICHERO,
  tipoDeFicheroNoAdmitido,
} from './mensajes-subida';
import { LOGO_MIME_ERROR } from '../modules/branding/branding.constants';

/**
 * i18n T5 — BARRERAS 2 y 3: los mensajes de subida, en español y con UN SOLO LECTOR.
 *
 * Traducir las once copias sin cerrar la fuente habría durado hasta la siguiente subida que
 * alguien añadiera copiando el `fileFilter` de al lado — que es exactamente cómo llegaron a
 * ser once. Por eso la mitad de esta suite no mira el texto, mira el REPO.
 */

const SRC = join(__dirname, '..');

function fuentes(dir: string): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) return fuentes(ruta);
    return /\.ts$/.test(entrada) && !/\.spec\.ts$/.test(entrada) ? [ruta] : [];
  });
}

const FICHEROS = fuentes(SRC);
const TODO = FICHEROS.map((r) => readFileSync(r, 'utf8')).join('\n');

describe('BARRERA 2 — los mensajes que el backoffice PINTA están en español', () => {
  it('el de formato no admitido', () => {
    expect(IMAGEN_TIPO_NO_ADMITIDO).toBe('Formato de fichero no admitido. Usa JPEG, PNG o WebP.');
  });

  it('el de fichero ausente', () => {
    expect(SIN_FICHERO).toBe('No se ha enviado ningún fichero.');
  });

  it('el de los logos, que admite SVG y por eso es suyo', () => {
    expect(LOGO_MIME_ERROR).toBe('Formato de fichero no admitido. Usa PNG, WebP, SVG o JPEG.');
  });

  it('los dos comparten redacción y sólo se diferencian en la lista', () => {
    // Es lo que justifica el constructor: si mañana se cambia «Formato de fichero no
    // admitido» por otra cosa, se cambia una vez y los dos siguen diciendo lo mismo.
    const [comun] = IMAGEN_TIPO_NO_ADMITIDO.split(' Usa ');
    expect(LOGO_MIME_ERROR.startsWith(comun)).toBe(true);
  });

  it('el constructor no inventa nada: pone la lista que se le da', () => {
    expect(tipoDeFicheroNoAdmitido('AVIF')).toBe('Formato de fichero no admitido. Usa AVIF.');
  });
});

describe('BARRERA 3 — un solo lector: nadie vuelve a escribir el mensaje a mano', () => {
  /**
   * Las formas que se persiguen. No es «la palabra inglesa»: es **cualquier** literal que
   * repita la frase, en inglés o en español. El defecto no era el idioma —eso ya está
   * arreglado— sino que hubiera once sitios donde cambiarla.
   */
  const COPIAS_A_MANO = [
    /'File type not allowed/,
    /"File type not allowed/,
    /'No file provided'/,
    /"No file provided"/,
    /'Formato de fichero no admitido/,
    /"Formato de fichero no admitido/,
    /'No se ha enviado ningún fichero/,
    /"No se ha enviado ningún fichero/,
  ];

  /** El único fichero al que se le permite escribirlas: su dueño. */
  const DUENO = join('common', 'mensajes-subida.ts');

  it('el barrido encuentra ficheros (red del propio test)', () => {
    // Sin esto, un barrido vacío pasaría en verde sin mirar nada.
    expect(FICHEROS.length).toBeGreaterThan(200);
  });

  it('la propia regla reconoce la forma que persigue (segunda red)', () => {
    const positivo = "throw new BadRequestException('No file provided');";
    const negativo = 'throw new BadRequestException(SIN_FICHERO);';
    expect(COPIAS_A_MANO.some((r) => r.test(positivo))).toBe(true);
    expect(COPIAS_A_MANO.some((r) => r.test(negativo))).toBe(false);
  });

  it('ningún fichero fuera del dueño escribe el mensaje a mano', () => {
    const infractores = FICHEROS.filter((ruta) => !ruta.endsWith(DUENO))
      .filter((ruta) => {
        const contenido = readFileSync(ruta, 'utf8');
        return COPIAS_A_MANO.some((r) => r.test(contenido));
      })
      .map((ruta) => ruta.slice(SRC.length + 1).replace(/\\/g, '/'));

    expect(infractores).toEqual([]);
  });

  it('y quedan las once llamadas al vocabulario, no cero', () => {
    // La otra mitad: la barrera anterior también pasaría si alguien BORRARA los mensajes en
    // vez de consolidarlos. Se comprueba que los sitios siguen ahí, usando la constante.
    const usos = TODO.match(/IMAGEN_TIPO_NO_ADMITIDO/g) ?? [];
    const ausencias = TODO.match(/SIN_FICHERO/g) ?? [];
    // 10 usos + su declaración e importaciones; el número exacto sube y baja con los
    // imports, así que se afirma el suelo: que sigue habiendo muchos y no ninguno.
    expect(usos.length).toBeGreaterThanOrEqual(10);
    expect(ausencias.length).toBeGreaterThanOrEqual(6);
  });
});

describe('BARRERA 5 — lo que NO se traduce, y por qué', () => {
  /**
   * Dos familias se quedan en inglés A PROPÓSITO, y conviene que esté escrito donde se lea
   * y no sólo en un commit:
   *
   *  · **Las firmas de webhook** (`Invalid webhook signature`, `Missing stripe-signature or
   *    body`, `Invalid Redsys signature`, `Missing required Redsys notification fields`).
   *    No las lee una persona: las lee Stripe y las lee Redsys, en sus paneles y en nuestros
   *    logs. Traducirlas empeoraría el diagnóstico sin mejorarle el día a nadie.
   *
   *  · **Los de `auth` y `jwt.strategy`** (`Invalid credentials`, `Session invalidated`…).
   *    No se ven: las pantallas de auth ramifican por `statusCode` y escriben su propio
   *    texto español (`auditoria-i18n-espanol.md` §7.2). Además `Invalid credentials` está
   *    afirmado en 23 sitios de la batería: cambiarlo es mover código de seguridad y sus
   *    tests para que nadie note nada.
   */
  it('las firmas de webhook siguen en inglés (es su público)', () => {
    expect(TODO).toContain('Invalid webhook signature');
    expect(TODO).toContain('Invalid Redsys signature');
  });

  it('los de auth siguen en inglés (nadie los ve; el front ramifica por statusCode)', () => {
    expect(TODO).toContain('Invalid credentials');
  });
});
