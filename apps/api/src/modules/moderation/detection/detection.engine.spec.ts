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
import { PhoneDetector } from './detectors/phone.detector';
import { PhoneListDetector, FLAGGED_PHONES_SETTING } from './detectors/phone-list.detector';
import type { PrismaService } from '../../../infra/prisma/prisma.service';

function conLista(
  words: unknown,
  opciones: {
    revienta?: boolean;
    modos?: unknown;
    modosRevientan?: boolean;
    telefonos?: unknown;
  } = {},
) {
  const findUnique = jest.fn(async ({ where }: { where: { key: string } }) => {
    // RÁFAGA B — el mismo `setting.findUnique` sirve las dos claves. Que el detector de
    // palabras reviente NO puede impedir leer los modos (ni al revés): son dos lecturas
    // con dueños distintos, y el `opciones.revienta` sólo tumba la de la lista.
    if (where.key === DETECTION_MODES_SETTING) {
      if (opciones.modosRevientan) throw new Error('no se pueden leer los modos');
      return opciones.modos === undefined ? null : { key: where.key, value: opciones.modos };
    }
    // A2 — la lista de teléfonos marcados, su propia clave.
    if (where.key === FLAGGED_PHONES_SETTING) {
      return opciones.telefonos === undefined
        ? null
        : { key: where.key, value: opciones.telefonos };
    }
    if (opciones.revienta) throw new Error('la base de datos no está');
    if (where.key !== BAD_WORD_LIST_SETTING) return null;
    return words === undefined ? null : { key: where.key, value: words };
  });
  const prisma = { setting: { findUnique } } as unknown as PrismaService;
  const detector = new WordDetector(prisma);
  const motor = new DetectionEngine(
    prisma,
    detector,
    new PhoneDetector(),
    new PhoneListDetector(prisma),
  );
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

describe('RÁFAGA C — EL FAIL-OPEN, CERRADO (aquí estaban los tres tests que exigían el defecto)', () => {
  // ESTOS TRES TESTS AFIRMABAN LO CONTRARIO, y su caída era su función: marcaban el sitio
  // exacto donde el arreglo se notaría, para que llegara POR DECISIÓN y no por accidente.
  // Ahora afirman la conducta nueva, en los mismos casos y con los mismos textos, para que
  // el diff enseñe el cambio en vez de esconderlo.

  it('una entrada de DOS PALABRAS ya casa — era el fail-open', async () => {
    // Antes: los tokens del texto eran {gana, dinero, facil, desde, casa} y la entrada se
    // comparaba ENTERA contra cada uno, así que «dinero facil» no casaba jamás.
    const { motor } = conLista(['dinero facil']);
    const { detections, blocking } = await motor.run(TEXTO('Gana dinero facil desde casa'));

    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({ detector: 'WORD', rule: 'dinero facil' });
    // Y `WORD` sigue en BLOCK: eso no cambia, lo que cambia es que ahora la entrada sirve.
    expect(blocking).toBe(true);
  });

  it('y con símbolos: la puntuación deja de importar en los DOS lados', async () => {
    // Ni el admin tiene que adivinar cómo puntuará el vendedor, ni al revés.
    const { motor } = conLista(['100%-garantizado']);
    const { detections } = await motor.run(TEXTO('Vendo con 100 % garantizado de fábrica'));
    expect(detections.map((d) => d.rule)).toEqual(['100%-garantizado']);
  });

  it('una IP puesta A MANO en la lista casa — es una cadena literal, no un patrón', async () => {
    // La distinción que hay que tener clara: una entrada de la lista es una CADENA LITERAL
    // que alguien tecleó —«bloquea ESE texto»—. Excluir «las entradas que parezcan una IP»
    // exigiría adivinar si `192.168.1.1` es una IP o una referencia con puntos, y adivinar
    // es lo que produce fail-opens.
    //
    // (A1 — hasta A1 la afirmación era «y NO pisa al detector de IPs», porque los dos la
    // veían. Ese detector se retiró, así que ahora sólo queda la lista.)
    const { motor } = conLista(['192.168.1.1']);
    const { detections } = await motor.run(
      TEXTO('Router configurado', 'entra en 192.168.1.1 para configurarlo'),
    );

    expect(detections.map((d) => d.detector)).toEqual(['WORD']);
  });

  it('SIN entrada en la lista, una IP en el texto no la ve NADIE', async () => {
    // La otra mitad. Demuestra dos cosas a la vez: que el arreglo de la ráfaga C no convirtió
    // la lista de palabras en un detector de patrones, y que el detector de IPs está retirado
    // de verdad.
    const { motor } = conLista([]);
    const { detections, blocking } = await motor.run(TEXTO('Router', 'entra en 192.168.1.1'));
    expect(detections).toEqual([]);
    expect(blocking).toBe(false);
  });
});

describe('RÁFAGA C — lo que el arreglo NO se lleva por delante', () => {
  it('PALABRA ENTERA: «estafa» sigue sin casar dentro de «estafador»', async () => {
    // Es la propiedad que el tokenizador daba gratis y que un `contains` a secas habría
    // destruido. Los espacios de guarda de `colapsar` son exactamente esto: sin ellos, el
    // detector que BLOQUEA empezaría a disparar con medio diccionario.
    const { motor } = conLista(['estafa']);
    const { blocking } = await motor.run(TEXTO('Vendo cosas, no soy estafador'));
    expect(blocking).toBe(false);
  });

  it('ni al principio ni al final de otra palabra', async () => {
    const { motor } = conLista(['casa']);
    const { detections } = await motor.run(TEXTO('Vendo una casaca y un casarón'));
    expect(detections).toEqual([]);
  });

  it('una entrada que se queda EN NADA al normalizar no casa con todo', async () => {
    // El fallo de manual que este arreglo podía introducir: «---» colapsa a un espacio
    // suelto, y un espacio está dentro de CUALQUIER texto. Una entrada así habría
    // bloqueado el marketplace entero.
    const { motor } = conLista(['---', '  ', '!!!']);
    const { detections, blocking } = await motor.run(TEXTO('Un anuncio perfectamente normal'));
    expect(detections).toEqual([]);
    expect(blocking).toBe(false);
  });

  it('los espacios de más dentro de una entrada no la rompen', async () => {
    const { motor } = conLista(['dinero    facil']);
    const { blocking } = await motor.run(TEXTO('Gana dinero facil'));
    expect(blocking).toBe(true);
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

  it('hay DOS detectores, y son WORD y PHONE', async () => {
    // Está para que añadir —o quitar— un detector sea explícito y no se cuele sin que nadie
    // lo decida. Eran tres hasta A1, que retiró el de IPs sobre texto; el propio texto de
    // este test tuvo que cambiar, que es justo lo que se quería.
    const { motor } = conLista(['estafa']);
    const { detections } = await motor.run(
      TEXTO('estafa', 'llama al 654123456 o entra en 192.168.1.1'),
    );
    expect(new Set(detections.map((d) => d.detector))).toEqual(new Set(['WORD', 'PHONE']));
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// RÁFAGA A — los dos detectores nuevos
// ───────────────────────────────────────────────────────────────────────────────────────

describe('A1 — EL DETECTOR DE IPs SOBRE TEXTO, RETIRADO', () => {
  // AQUÍ VIVÍAN SIETE TESTS del detector de IPv4 en el título y la descripción. Se han
  // borrado con él, y este bloque queda para que la retirada sea EXPLÍCITA en el diff en
  // vez de una ausencia que nadie note.
  //
  // POR QUÉ SE RETIRÓ: no respondía a ninguna pregunta que alguien hiciera. Una IP en la
  // descripción de un anuncio suele ser PRODUCTO —quien vende un router y documenta su
  // 192.168.1.1— y no señal. El detector de teléfonos sí tiene un caso de uso escrito
  // (esquivar la puerta de GET /listings/:id/phone); éste no tenía equivalente.
  //
  // Lo que sí hacía falta —«esta IP concreta es fraudulenta»— se mira en `lastOwnerIp` y
  // `lastLoginIp`, y ni siquiera necesita un detector: es «columna IN (lista)», derivado
  // en cada lectura. Ver `flagged-ips.ts` y `deteccion-ips-marcadas.e2e-spec.ts`.
  //
  // SE DECIDIÓ SIN DATOS, a propósito: el banco de pruebas nunca llegó a medirlo. Es lo
  // único irreversible de A1.

  it('una IP escrita en el texto YA NO genera ninguna detección', async () => {
    const { motor } = conLista([]);
    const { detections, blocking } = await motor.run(
      TEXTO('Router', 'Se configura entrando en 192.168.1.1.'),
    );
    expect(detections).toEqual([]);
    expect(blocking).toBe(false);
  });

  it('pero puesta A MANO en la lista de palabras sigue casando — eso es otra cosa', async () => {
    // La distinción que la ráfaga C dejó escrita: una entrada de la lista es una CADENA
    // LITERAL que alguien tecleó («bloquea ESE texto»). Lo que se ha retirado es la
    // HEURÍSTICA que disparaba con cualquier IP, legítimas incluidas.
    const { motor } = conLista(['192.168.1.1']);
    const { detections } = await motor.run(TEXTO('Router', 'entra en 192.168.1.1'));
    expect(detections.map((d) => d.detector)).toEqual(['WORD']);
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
  it('si el de palabras revienta, PHONE sigue encontrando', async () => {
    // Con un solo detector «falla el detector» y «falla el motor» eran lo mismo. Ahora no,
    // y es la mitad de por qué el fallo se acota por detector: un patrón mal formado no
    // puede apagar el filtro que sí bloquea, ni al revés.
    const { motor } = conLista(['estafa'], { revienta: true });
    const { detections, blocking } = await motor.run(
      TEXTO('Router', 'entra en 192.168.1.1 o llama al 654123456'),
    );

    // La IP del texto ya no la ve nadie (A1); el teléfono sí, pese al detector caído.
    expect(detections.map((d) => d.detector)).toEqual(['PHONE']);
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

  it('un valor basura en PHONE no cambia lo que hace WORD', () => {
    const modos = parseDetectionModes({ WORD: 'BLOCK', PHONE: 'BLOQUEAR_YA' });
    expect(modos).toEqual({ WORD: 'BLOCK', PHONE: 'WARN', PHONE_LIST: 'WARN' });
  });

  it('una clave `IP` sobrante de antes de A1 es INERTE, no rompe nada', () => {
    // La migración de A1 NO reescribió `detectionModes`: tocar un ajuste que un admin puso a
    // mano, para quitarle una línea que ya no hace nada, sería cambiarle la configuración
    // sin motivo. `parseDetectionModes` recorre los detectores que EXISTEN, así que la clave
    // vieja simplemente se descarta.
    expect(parseDetectionModes({ WORD: 'BLOCK', IP: 'BLOCK', PHONE: 'WARN' })).toEqual({
      WORD: 'BLOCK',
      PHONE: 'WARN',
      // A2 — sin declarar en el ajuste, cae a su modo de nacimiento.
      PHONE_LIST: 'WARN',
    });
  });

  it('si la lectura del ajuste REVIENTA, se cae a los modos de nacimiento (no a «nadie bloquea»)', async () => {
    // La dirección del fail-open importa: caer a «todo en WARN» apagaría el filtro de
    // palabras cada vez que la base tosiera, y nadie lo notaría.
    const { motor } = conLista(['estafa'], { modosRevientan: true });
    const { blocking } = await motor.run(TEXTO('Vendo estafa'));
    expect(blocking).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// A2 — la lista de teléfonos marcados
// ───────────────────────────────────────────────────────────────────────────────────────

describe('A2 — PHONE_LIST casa un número marcado en cualquier formato', () => {
  it('LA BARRERA: el reconocedor es el mismo, así que los formatos dan igual', () => {
    // La lista lleva UNA forma; el anuncio puede llevar otra. Casan porque los dos lados se
    // canonizan con la misma función — la que también usa el detector heurístico y la
    // columna de búsqueda. Escribir aquí un segundo patrón «parecido» habría producido el
    // clásico: uno que encuentra una cosa y otro que encuentra otra.
    const casos: [string, string][] = [
      ['654123456', 'llama al 654 123 456'],
      ['654 123 456', 'llama al 654123456'],
      ['+34 654 123 456', 'mi numero: 654-12-34-56'],
      ['0034654123456', 'tel 654.123.456'],
    ];
    return Promise.all(
      casos.map(async ([enLaLista, enElAnuncio]) => {
        const { motor } = conLista([], { telefonos: [enLaLista] });
        const { detections } = await motor.run(TEXTO('Bici', enElAnuncio));
        const deLista = detections.filter((d) => d.detector === 'PHONE_LIST');
        expect(deLista).toHaveLength(1);
        // `rule` devuelve la entrada TAL COMO LA ESCRIBIÓ el admin: quien lea el aviso
        // tiene que reconocer su propia regla para poder corregirla.
        expect(deLista[0].rule).toBe(enLaLista);
      }),
    );
  });

  it('un número que NO está en la lista no la dispara', async () => {
    const { motor } = conLista([], { telefonos: ['654123456'] });
    const { detections } = await motor.run(TEXTO('Bici', 'llama al 611222333'));
    expect(detections.filter((d) => d.detector === 'PHONE_LIST')).toEqual([]);
    // Pero el HEURÍSTICO sí avisa: hay un teléfono fuera de su sitio, esté marcado o no.
    expect(detections.map((d) => d.detector)).toEqual(['PHONE']);
  });

  it('CONVIVENCIA: un número marcado dispara LOS DOS, distinguibles', async () => {
    // Las dos preguntas a la vez sobre el mismo número: «hay un teléfono fuera de su sitio»
    // (evasión) y «ese número está marcado» (reincidencia). El staff ve las dos.
    const { motor } = conLista([], { telefonos: ['654123456'] });
    const { detections } = await motor.run(TEXTO('Bici', 'llama al 654123456'));
    expect(detections.map((d) => d.detector).sort()).toEqual(['PHONE', 'PHONE_LIST']);
  });

  it('NACE EN WARN: marca y no bloquea', async () => {
    const { motor } = conLista([], { telefonos: ['654123456'] });
    const { blocking } = await motor.run(TEXTO('Bici', 'llama al 654123456'));
    expect(blocking).toBe(false);
  });

  it('y asciende cambiando el ajuste, como cualquier otro', async () => {
    const { motor } = conLista([], {
      telefonos: ['654123456'],
      modos: { PHONE_LIST: 'BLOCK' },
    });
    const { detections, blocking } = await motor.run(TEXTO('Bici', 'llama al 654123456'));
    expect(blocking).toBe(true);
    // Bloquear es avisar MÁS una consecuencia: el rastro es el mismo.
    expect(detections.filter((d) => d.detector === 'PHONE_LIST')).toHaveLength(1);
  });

  it('sin lista, o con la lista vacía, no encuentra nada', async () => {
    for (const telefonos of [undefined, []]) {
      const { motor } = conLista([], { telefonos });
      const { detections } = await motor.run(TEXTO('Bici', 'llama al 654123456'));
      expect(detections.filter((d) => d.detector === 'PHONE_LIST')).toEqual([]);
    }
  });

  it('una entrada que no es un teléfono se descarta y no rompe la lista', async () => {
    // Se descarta EN SILENCIO aquí; la pantalla de ajustes es la que la señala. Lo que no
    // puede es impedir que el resto de la lista funcione.
    const { motor } = conLista([], { telefonos: ['no-soy-un-telefono', '654123456'] });
    const { detections } = await motor.run(TEXTO('Bici', 'llama al 654123456'));
    expect(detections.filter((d) => d.detector === 'PHONE_LIST')).toHaveLength(1);
  });
});

describe('A2 — LA ASIMETRÍA DE CAMPOS', () => {
  it('el campo `phone` lo mira PHONE_LIST y NO el heurístico', async () => {
    // LA BARRERA DE LA ASIMETRÍA, y las dos mitades importan:
    //   · un número marcado lo está esté donde esté — también en su campo legítimo;
    //   · un teléfono en su propio campo NO esquiva nada, así que el heurístico —que
    //     persigue evasión— no tiene nada que decir ahí. Si lo mirara, avisaría de que el
    //     vendedor usó el canal correcto.
    const { motor } = conLista([], { telefonos: ['654123456'] });
    const { detections } = await motor.run({
      title: 'Bici',
      description: 'Sin datos de contacto en el texto.',
      phone: '654 123 456',
    });

    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({
      detector: 'PHONE_LIST',
      field: 'PHONE',
      rule: '654123456',
    });
  });

  it('un teléfono NO marcado en su campo no dispara NADA', async () => {
    // La otra mitad de la asimetría: el heurístico sigue sin mirar ahí.
    const { motor } = conLista([], { telefonos: ['611222333'] });
    const { detections } = await motor.run({
      title: 'Bici',
      description: 'Sin datos de contacto.',
      phone: '654123456',
    });
    expect(detections).toEqual([]);
  });

  it('sin campo `phone` no pasa nada — es opcional', async () => {
    const { motor } = conLista([], { telefonos: ['654123456'] });
    const { detections } = await motor.run(TEXTO('Bici', 'sin nada'));
    expect(detections).toEqual([]);
  });
});
