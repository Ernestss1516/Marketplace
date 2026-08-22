/**
 * PUNTO 6 · RÁFAGA 0 — LA BARRERA DE LA EXTRACCIÓN: la conducta NO cambia.
 *
 * La barrera principal de esta ráfaga son los tests que YA existen (`moderacion-previa`,
 * `admin`): si hubiera que editarlos, la extracción habría cambiado la conducta. Este
 * fichero es la otra mitad, y hace algo que aquéllos no pueden:
 *
 *  1. **CLAVA la semántica exacta del emparejamiento**, incluida la parte que está mal. El
 *     tokenizador parte por lo no alfanumérico, así que sólo casan las entradas de UNA
 *     palabra: `192.168.1.1` y `dinero facil` **no casan nunca**. Eso es fail-open y es un
 *     fallo vivo, pero la ráfaga 0 NO lo arregla —arreglarlo endurece en silencio un
 *     detector que está en modo BLOQUEAR—, así que aquí se AFIRMA que sigue roto.
 *
 *     Suena raro escribir un test que exige un defecto. No lo es: lo que fija es que la
 *     extracción no lo tocó, y cuando la ráfaga C lo arregle, **este test tiene que caerse**.
 *     Caerse ahí será la señal de que el arreglo llegó, no un accidente. Ver §5.4 del diseño.
 *
 *  2. **Cubre la única diferencia de cálculo de la extracción**: antes se tokenizaban título
 *     y descripción JUNTOS (`${title} ${description}`) y ahora por separado, para poder
 *     decir en qué campo apareció. El conjunto de tokens es el mismo porque el separador era
 *     un espacio y el espacio ya partía; el test lo demuestra en el borde.
 *
 *  3. **El fail-open del contrato**, que `BadWordService` declaraba por escrito y ahora vive
 *     acotado por detector.
 *
 * Se prueba con un Prisma de mentira porque el cuerpo es puro salvo UNA lectura, y montar
 * base de datos para comprobar un tokenizador cuesta más que lo que prueba.
 */

import { DetectionEngine } from './detection.engine';
import { DETECTION_MODES_SETTING, parseDetectionModes } from './detection.types';
import { WordDetector, BAD_WORD_LIST_SETTING } from './detectors/word.detector';
import { IpDetector } from './detectors/ip.detector';
import { PhoneDetector } from './detectors/phone.detector';
import type { PrismaService } from '../../../infra/prisma/prisma.service';

function conLista(
  words: unknown,
  opciones: { revienta?: boolean; modos?: unknown; modosRevientan?: boolean } = {},
) {
  const findUnique = jest.fn(async ({ where }: { where: { key: string } }) => {
    // RÁFAGA B — el mismo `setting.findUnique` sirve las dos claves. Que el detector de
    // palabras reviente NO puede impedir leer los modos (ni al revés): son dos lecturas
    // con dueños distintos, y el `opciones.revienta` sólo tumba la de la lista.
    if (where.key === DETECTION_MODES_SETTING) {
      if (opciones.modosRevientan) throw new Error('no se pueden leer los modos');
      return opciones.modos === undefined ? null : { key: where.key, value: opciones.modos };
    }
    if (opciones.revienta) throw new Error('la base de datos no está');
    if (where.key !== BAD_WORD_LIST_SETTING) return null;
    return words === undefined ? null : { key: where.key, value: words };
  });
  const prisma = { setting: { findUnique } } as unknown as PrismaService;
  const detector = new WordDetector(prisma);
  const motor = new DetectionEngine(prisma, detector, new IpDetector(), new PhoneDetector());
  return { motor, detector, findUnique };
}

const TEXTO = (title: string, description = '') => ({ title, description });

describe('el detector de palabras casa igual que antes de la extracción', () => {
  it('una palabra suelta de la lista casa, en el título', async () => {
    const { motor } = conLista(['estafa']);
    const { detections, blocking } = await motor.run(TEXTO('Vendo estafa segura', 'nada'));

    expect(detections).toHaveLength(1);
    expect(detections[0]).toEqual({
      detector: 'WORD',
      field: 'TITLE',
      match: 'estafa',
      rule: 'estafa',
    });
    // `WORD` está en BLOCK, que es lo que hace desde siempre: `blocking` es lo que antes
    // devolvía `hasBadWords`, y es lo que `publish()` convierte en PENDING_REVIEW.
    expect(blocking).toBe(true);
  });

  it('y en la descripción', async () => {
    const { motor } = conLista(['estafa']);
    const { detections } = await motor.run(TEXTO('Un título limpio', 'esto es una estafa'));
    expect(detections.map((d) => d.field)).toEqual(['DESCRIPTION']);
  });

  it('sin acentos y sin mayúsculas: la normalización es la de siempre', async () => {
    const { motor } = conLista(['estafa']);
    const { blocking } = await motor.run(TEXTO('ESTÁFA en mayúsculas'));
    expect(blocking).toBe(true);
  });

  it('lo que no está en la lista no casa', async () => {
    const { motor } = conLista(['estafa']);
    const { detections, blocking } = await motor.run(TEXTO('Bicicleta de montaña', 'Como nueva'));
    expect(detections).toEqual([]);
    expect(blocking).toBe(false);
  });

  it('casa la palabra ENTERA, no un trozo', async () => {
    // `tokens.has(w)` es igualdad exacta contra un token: «estafa» no casa dentro de
    // «estafador». Es la semántica actual y se conserva tal cual.
    const { motor } = conLista(['estafa']);
    const { blocking } = await motor.run(TEXTO('Vendo cosas, no soy estafador'));
    expect(blocking).toBe(false);
  });
});

describe('EL FAIL-OPEN QUE LA RÁFAGA 0 NO ARREGLA (y afirma que sigue ahí)', () => {
  // Cuando la ráfaga C arregle el emparejamiento multi-palabra, ESTOS DOS TESTS TIENEN QUE
  // CAERSE. Es su función: marcar el sitio exacto donde el arreglo se notará.

  it('una IP en la lista de palabras NO detecta nada — el tokenizador la parte', async () => {
    const { motor } = conLista(['192.168.1.1']);
    const { detections, blocking } = await motor.run(
      TEXTO('Router configurado', 'entra en 192.168.1.1 para configurarlo'),
    );

    // El texto SÍ contiene la IP; la entrada de la lista se normaliza a «192.168.1.1» y se
    // compara contra los tokens {192, 168, 1}, así que no casa jamás. El admin escribió
    // una regla, la pantalla se la guardó, y no filtra nada.
    //
    // Se filtra por `WORD` porque desde la ráfaga A **el detector de IPs SÍ la encuentra**
    // (ver «LA BARRERA DEL PUNTO 6»). Ése es justamente el arreglo: no se enseña a la lista
    // de palabras a ver IPs, se le da a las IPs su propio detector. Lo que este test fija es
    // que la lista sigue sin poder — y por eso sigue sin bloquear.
    expect(detections.filter((d) => d.detector === 'WORD')).toEqual([]);
    expect(blocking).toBe(false);
  });

  it('una entrada de DOS palabras tampoco casa nunca', async () => {
    const { motor } = conLista(['dinero facil']);
    const { blocking } = await motor.run(TEXTO('Gana dinero facil desde casa'));
    expect(blocking).toBe(false);
  });

  it('pero sus trozos sueltos sí, que es lo que hace el fallo invisible', async () => {
    // Quien escribió «dinero facil» y vio que «algo» se filtraba pudo creer que funcionaba:
    // lo que casó fue otra entrada, no la suya.
    const { motor } = conLista(['dinero facil', 'dinero']);
    const { detections } = await motor.run(TEXTO('Gana dinero facil desde casa'));
    expect(detections.map((d) => d.rule)).toEqual(['dinero']);
  });
});

describe('la única diferencia de cálculo: tokenizar por campo', () => {
  it('un token NO puede cruzar la frontera entre título y descripción', async () => {
    // Antes se tokenizaba `${title} ${description}` junto, con un ESPACIO en medio — y el
    // espacio ya era separador. Así que «dine» + «ro» no formaban «dinero» ni entonces ni
    // ahora. Es la propiedad que hace que partir por campos dé el mismo conjunto de tokens.
    const { motor } = conLista(['dinero']);
    const { blocking } = await motor.run(TEXTO('dine', 'ro'));
    expect(blocking).toBe(false);
  });

  it('la misma palabra en los dos campos deja UNA detección por campo', async () => {
    const { motor } = conLista(['estafa']);
    const { detections } = await motor.run(TEXTO('estafa', 'estafa'));
    expect(detections.map((d) => d.field)).toEqual(['TITLE', 'DESCRIPTION']);
  });
});

describe('el contrato de fallo — fail-open, acotado por detector', () => {
  it('sin fila de ajuste no se detecta nada y no se lanza', async () => {
    const { motor } = conLista(undefined);
    await expect(motor.run(TEXTO('lo que sea'))).resolves.toEqual({
      detections: [],
      blocking: false,
    });
  });

  it('con la lista vacía tampoco', async () => {
    const { motor } = conLista([]);
    const { blocking } = await motor.run(TEXTO('lo que sea'));
    expect(blocking).toBe(false);
  });

  it('con entradas en blanco tampoco (se filtran tras normalizar)', async () => {
    const { motor } = conLista(['   ', '']);
    const { blocking } = await motor.run(TEXTO('lo que sea'));
    expect(blocking).toBe(false);
  });

  it('SI LA CONSULTA REVIENTA, el motor NO lanza y no bloquea', async () => {
    // Es el contrato escrito que `BadWordService` declaraba: moderar no puede frenar
    // publicar. `publish()` sigue teniendo además su propio try/catch, pero no lo necesita.
    const { motor } = conLista(['estafa'], { revienta: true });
    await expect(motor.run(TEXTO('estafa'))).resolves.toEqual({
      detections: [],
      blocking: false,
    });
  });
});

describe('la estructura del motor', () => {
  it('la lista de palabras se lee UNA vez por pasada', async () => {
    // Una lectura por detector que la necesite, no una por palabra de la lista — y los
    // detectores de patrón no leen nada.
    //
    // Se cuenta SÓLO la clave de la lista: desde la ráfaga B el motor lee además los modos,
    // que es la lectura que la ráfaga 0 se negó a hacer para no cambiar la conducta. Contar
    // todas las llamadas mezclaría dos cosas distintas.
    const { motor, findUnique } = conLista(['estafa']);
    await motor.run(TEXTO('estafa', 'estafa'));
    const lecturasDeLaLista = findUnique.mock.calls.filter(
      ([arg]) => (arg as { where: { key: string } }).where.key === BAD_WORD_LIST_SETTING,
    );
    expect(lecturasDeLaLista).toHaveLength(1);
  });

  it('hay TRES detectores, y son WORD, IP y PHONE', async () => {
    // Está para que añadir un detector sea explícito y no se cuele ninguno sin que nadie
    // lo decida. Cuando cambie el número, alguien tuvo que venir aquí.
    const { motor } = conLista(['estafa']);
    const { detections } = await motor.run(
      TEXTO('estafa', 'llama al 654123456 o entra en 192.168.1.1'),
    );
    expect(new Set(detections.map((d) => d.detector))).toEqual(
      new Set(['WORD', 'IP', 'PHONE']),
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// RÁFAGA A — los dos detectores nuevos
// ───────────────────────────────────────────────────────────────────────────────────────

describe('RÁFAGA A — el detector de IPs mira el texto CRUDO', () => {
  it('LA BARRERA DEL PUNTO 6: la IP que la lista de palabras no puede ver, SÍ la ve', async () => {
    // Es la afirmación exacta que justifica que existan detectores propios. La misma IP,
    // el mismo texto: puesta en `badWordList` no casa nunca (ver el bloque del fail-open);
    // con su detector, se detecta ENTERA — sin partir por los puntos.
    const { motor } = conLista(['192.168.1.1']);
    const { detections } = await motor.run(
      TEXTO('Router', 'configuración en 192.168.1.1 para entrar'),
    );

    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({
      detector: 'IP',
      field: 'DESCRIPTION',
      match: '192.168.1.1',
      rule: null,
    });
    // Y NO BLOQUEA: nace avisando. El anuncio no se va a revisión por esto.
    expect((await motor.run(TEXTO('192.168.1.1'))).blocking).toBe(false);
  });

  it('valida los octetos: 999.999.999.999 no es una IP', async () => {
    // Sin la validación de rango el detector sería aún más ruidoso de lo que ya es.
    const { motor } = conLista([]);
    const { detections } = await motor.run(TEXTO('ref 999.999.999.999'));
    expect(detections.filter((d) => d.detector === 'IP')).toEqual([]);
  });

  it('LOS DETECTORES SE SOLAPAN, y se deja escrito en vez de disimularlo', async () => {
    // Descubierto escribiendo el test de arriba: `999.999.999.999` no es una IP —el rango lo
    // rechaza— pero el detector de TELÉFONOS ve nueve dígitos que empiezan por 9 con puntos
    // en medio y lo da por un fijo. Es un falso positivo real de PHONE.
    //
    // NO SE «ARREGLA» quitándole el punto a los separadores del teléfono: hay quien escribe
    // «654.123.456», y estrechar un patrón para esquivar UNA anécdota, sin un solo dato de
    // frecuencia, es exactamente lo que el modo avisar existe para no tener que hacer. Se
    // anota, se mide avisando, y con datos delante se decide. Ver §2.2 del diseño.
    const { motor } = conLista([]);
    const { detections, blocking } = await motor.run(TEXTO('ref 999.999.999.999'));
    expect(detections.map((d) => d.detector)).toEqual(['PHONE']);
    expect(blocking).toBe(false);
  });

  it('no se inventa un acierto dentro de una tirada más larga', async () => {
    const { motor } = conLista([]);
    const { detections } = await motor.run(TEXTO('version 10.1.2.3.4 del firmware'));
    expect(detections).toEqual([]);
  });

  it('LA IP AL FINAL DE UNA FRASE, con su punto — el caso más común de todos', async () => {
    // Este test nació de un fallo real: la primera versión de la guarda rechazaba «un punto
    // cualquiera» detrás, así que «…entrando en 192.168.1.1.» no detectaba NADA. Un detector
    // de IPs que no ve las IPs escritas al final de una oración no sirve para leer
    // descripciones, que es lo único que hace.
    const { motor } = conLista([]);
    const { detections } = await motor.run(TEXTO('Router', 'Se configura entrando en 192.168.1.1.'));
    expect(detections.map((d) => d.match)).toEqual(['192.168.1.1']);
  });

  it('y el último octeto de dos dígitos no se corta', async () => {
    const { motor } = conLista([]);
    const { detections } = await motor.run(TEXTO('192.168.1.10'));
    expect(detections.map((d) => d.match)).toEqual(['192.168.1.10']);
  });

  it('encuentra varias, y en los dos campos', async () => {
    const { motor } = conLista([]);
    const { detections } = await motor.run(TEXTO('8.8.8.8', 'y también 1.1.1.1'));
    expect(detections.map((d) => [d.field, d.match])).toEqual([
      ['TITLE', '8.8.8.8'],
      ['DESCRIPTION', '1.1.1.1'],
    ]);
  });
});

describe('RÁFAGA A — el detector de teléfonos', () => {
  it.each([
    ['654123456', 'seguidos'],
    ['654 123 456', 'con espacios'],
    ['654-12-34-56', 'con guiones'],
    ['+34 654 123 456', 'con prefijo internacional'],
    ['0034654123456', 'con 00 34'],
    ['912345678', 'un fijo'],
  ])('detecta %s (%s)', async (numero) => {
    const { motor } = conLista([]);
    const { detections } = await motor.run(TEXTO('Vendo bici', `llámame al ${numero}`));
    expect(detections).toHaveLength(1);
    expect(detections[0].detector).toBe('PHONE');
  });

  it('NO BLOQUEA: nace avisando', async () => {
    // La barrera del banco de pruebas. Es anti-EVASIÓN, no anti-teléfono: `Listing.phone`
    // existe y está tras `JwtAuthGuard`, así que lo que esto señala es que el vendedor
    // esquiva esa puerta. Sacar el anuncio del escaparate por eso, sin datos, sería
    // desproporcionado.
    const { motor } = conLista([]);
    const { blocking } = await motor.run(TEXTO('Vendo bici', 'llámame al 654123456'));
    expect(blocking).toBe(false);
  });

  it('un número de 8 dígitos no es un teléfono español', async () => {
    const { motor } = conLista([]);
    const { detections } = await motor.run(TEXTO('ref 65412345'));
    expect(detections).toEqual([]);
  });

  it('no empieza por 1-5: no es un móvil ni un fijo español', async () => {
    const { motor } = conLista([]);
    const { detections } = await motor.run(TEXTO('ref 123456789'));
    expect(detections).toEqual([]);
  });

  it('no se inventa un acierto dentro de una tirada más larga', async () => {
    // Sin las guardas de los extremos, un número de veinte dígitos daría un acierto por
    // cada ventana de nueve.
    const { motor } = conLista([]);
    const { detections } = await motor.run(TEXTO('IMEI 654123456789012345'));
    expect(detections).toEqual([]);
  });

  it('EL FALSO POSITIVO QUE SE ACEPTA A SABIENDAS, y es por lo que avisa y no bloquea', async () => {
    // Una referencia de nueve dígitos que empieza por 9 es indistinguible de un fijo. El
    // detector la marca. En modo BLOQUEAR esto sacaría del escaparate un anuncio correcto;
    // en AVISAR sólo le cuesta al moderador un vistazo. Es el dato que la ráfaga B necesita
    // antes de decidir si este detector se ha ganado bloquear.
    const { motor } = conLista([]);
    const { detections, blocking } = await motor.run(TEXTO('Recambio', 'referencia 987654321'));
    expect(detections).toHaveLength(1);
    expect(blocking).toBe(false);
  });
});

describe('RÁFAGA A — un detector caído no arrastra a los demás', () => {
  it('si el de palabras revienta, IP y PHONE siguen encontrando', async () => {
    // Con un solo detector «falla el detector» y «falla el motor» eran lo mismo. Ahora no,
    // y es la mitad de por qué el fallo se acota por detector: un patrón mal formado no
    // puede apagar el filtro que sí bloquea, ni al revés.
    const { motor } = conLista(['estafa'], { revienta: true });
    const { detections, blocking } = await motor.run(
      TEXTO('Router', 'entra en 192.168.1.1 o llama al 654123456'),
    );

    expect(new Set(detections.map((d) => d.detector))).toEqual(new Set(['IP', 'PHONE']));
    expect(blocking).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// RÁFAGA B — el ascenso: cambiar el MODO, no el detector
// ───────────────────────────────────────────────────────────────────────────────────────

describe('RÁFAGA B — ascender un detector es cambiar un valor', () => {
  const TEXTO_CON_TELEFONO = TEXTO('Vendo bici', 'llámame al 654123456');

  it('EL MISMO TEXTO Y EL MISMO DETECTOR: avisa o bloquea según el ajuste', async () => {
    // LA BARRERA DEL ASCENSO. Las dos mitades en una prueba porque lo que hay que demostrar
    // no es que bloquee, sino que **es el mismo camino de código** con otro valor: si
    // ascender exigiera otra rama, otro detector o un despliegue, el diseño estaría mal.
    const avisando = conLista([], { modos: { PHONE: 'WARN' } });
    const a = await avisando.motor.run(TEXTO_CON_TELEFONO);
    expect(a.detections.map((d) => d.detector)).toEqual(['PHONE']);
    expect(a.blocking).toBe(false);

    const bloqueando = conLista([], { modos: { PHONE: 'BLOCK' } });
    const b = await bloqueando.motor.run(TEXTO_CON_TELEFONO);
    // MISMAS DETECCIONES: bloquear es avisar MÁS una consecuencia, no otra cosa. Por eso
    // degradar de vuelta no pierde nada.
    expect(b.detections).toEqual(a.detections);
    expect(b.blocking).toBe(true);
  });

  it('sin ajuste, los modos son los de nacimiento', async () => {
    const { motor } = conLista([], { modos: undefined });
    const { blocking } = await motor.run(TEXTO_CON_TELEFONO);
    expect(blocking).toBe(false);
  });

  it('degradar `WORD` a AVISAR también se respeta — el ajuste manda en los tres', async () => {
    const { motor } = conLista(['estafa'], { modos: { WORD: 'WARN' } });
    const { detections, blocking } = await motor.run(TEXTO('Vendo estafa'));
    expect(detections.map((d) => d.detector)).toEqual(['WORD']);
    expect(blocking).toBe(false);
  });

  it('los modos se leen UNA vez por pasada', async () => {
    const { motor, findUnique } = conLista([], { modos: { PHONE: 'BLOCK' } });
    await motor.run(TEXTO_CON_TELEFONO);
    const lecturasDeModos = findUnique.mock.calls.filter(
      ([arg]) => (arg as { where: { key: string } }).where.key === DETECTION_MODES_SETTING,
    );
    expect(lecturasDeModos).toHaveLength(1);
  });
});

describe('RÁFAGA B — un ajuste roto NO puede apagar el filtro que sí bloquea', () => {
  // Es la decisión que más importa de `parseDetectionModes`, y por eso tiene tests propios:
  // si un `detectionModes` a medio escribir tumbara el objeto entero, un error de tecleo
  // APAGARÍA EL FILTRO DE PALABRAS EN SILENCIO. Cada clave cae a su defecto por separado.

  it.each([
    ['null', null],
    ['un array', ['WORD']],
    ['una cadena', 'BLOCK'],
    ['un objeto vacío', {}],
    ['un valor mal escrito', { WORD: 'bloquear' }],
    ['una clave que no existe', { NOPE: 'WARN' }],
  ])('con %s, WORD sigue bloqueando', (_caso, valor) => {
    expect(parseDetectionModes(valor).WORD).toBe('BLOCK');
  });

  it('un valor basura en IP no cambia lo que hace WORD', () => {
    const modos = parseDetectionModes({ WORD: 'BLOCK', IP: 'BLOQUEAR_YA' });
    expect(modos).toEqual({ WORD: 'BLOCK', IP: 'WARN', PHONE: 'WARN' });
  });

  it('si la lectura del ajuste REVIENTA, se cae a los modos de nacimiento (no a «nadie bloquea»)', async () => {
    // La dirección del fail-open importa: caer a «todo en WARN» apagaría el filtro de
    // palabras cada vez que la base tosiera, y nadie lo notaría.
    const { motor } = conLista(['estafa'], { modosRevientan: true });
    const { blocking } = await motor.run(TEXTO('Vendo estafa'));
    expect(blocking).toBe(true);
  });
});
