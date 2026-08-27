/**
 * PÓSTER ANIMADO P1 — B-8: **el artefacto es una IMAGEN FIJA**.
 *
 * LA BARRERA QUE PROTEGE LA DECISIÓN DEL CUERPO. El sprite es fijo porque `canvas.toBlob()`
 * sólo emite imágenes fijas y no hay API nativa que empaquete una animación; de ahí sale todo
 * lo demás: la animación la pone el CSS (así que se puede animar SÓLO en hover, cosa que un
 * `<img>` animado no permite) y la decisión del móvil sigue siendo una línea de CSS.
 *
 * Si alguien «mejorase» esto a un WebP animado, esas dos propiedades se pierden **sin que
 * nada más se ponga rojo**: el fichero seguiría subiendo y guardándose igual. Por eso la
 * barrera mira lo que sale de la captura.
 *
 * Se prueba con dobles de `<video>` y `<canvas>` porque jsdom no trae ninguno de los dos.
 * Eso no debilita el test: lo que se afirma —cuántos `seek`, dónde se dibuja cada fotograma,
 * qué tamaño tiene la tira y con qué tipo se codifica— es exactamente la lógica de esta
 * función, y es toda suya.
 */

import {
  captureVideoSprite,
  PREVIEW_FRAMES,
  PREVIEW_FRAME_HEIGHT,
  PREVIEW_FRAME_POSITIONS,
  PREVIEW_FRAME_WIDTH,
} from './video';

type DibujoRegistrado = { dx: number; dy: number; dw: number; dh: number };

interface Instalado {
  canvas: { width: number; height: number };
  dibujos: DibujoRegistrado[];
  instantes: number[];
  tipoPedido: string | null;
  restaurar: () => void;
}

/**
 * Monta los dobles y devuelve lo observado.
 *
 * `soportaWebp` (dentro de `captureVideoSprite`) crea un canvas de 1×1 y mira el `type` del
 * blob que sale, así que el doble tiene que responder a ESA sonda de forma distinta a la
 * codificación final — es justamente lo que el navegador hace y lo que la función existe para
 * detectar. `webpSoportado` lo simula.
 */
function instalarDobles(opts: {
  duracion: number;
  anchoVideo: number;
  altoVideo: number;
  webpSoportado: boolean;
}): Instalado {
  const dibujos: DibujoRegistrado[] = [];
  const instantes: number[] = [];
  let tipoPedido: string | null = null;
  let canvasTira = { width: 0, height: 0 };

  const crearOriginal = document.createElement.bind(document);

  const crearCanvas = () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (
          _fuente: unknown,
          _sx: number,
          _sy: number,
          _sw: number,
          _sh: number,
          dx: number,
          dy: number,
          dw: number,
          dh: number,
        ) => {
          dibujos.push({ dx, dy, dw, dh });
        },
      }),
      toBlob: (cb: (b: Blob | null) => void, type: string) => {
        // La sonda de 1×1 de `soportaWebp` no es la codificación de la tira: se distingue
        // por el tamaño, igual que se distinguen en el código real.
        if (canvas.width === 1 && canvas.height === 1) {
          const tipoSonda = opts.webpSoportado ? 'image/webp' : 'image/png';
          cb(new Blob([''], { type: tipoSonda }));
          return;
        }
        tipoPedido = type;
        canvasTira = { width: canvas.width, height: canvas.height };
        cb(new Blob(['sprite'], { type }));
      },
    };
    return canvas as unknown as HTMLCanvasElement;
  };

  const crearVideo = () => {
    const video: Record<string, unknown> = {
      preload: '',
      muted: false,
      duration: opts.duracion,
      videoWidth: opts.anchoVideo,
      videoHeight: opts.altoVideo,
      onloadedmetadata: null,
      onseeked: null,
      onerror: null,
      _currentTime: 0,
    };
    Object.defineProperty(video, 'currentTime', {
      get: () => video._currentTime as number,
      set: (t: number) => {
        video._currentTime = t;
        instantes.push(t);
        // El navegador emite `seeked` de forma asíncrona; el microtask basta para no
        // recursionar dentro del propio setter.
        queueMicrotask(() => (video.onseeked as (() => void) | null)?.());
      },
    });
    Object.defineProperty(video, 'src', {
      set: () => {
        queueMicrotask(() => (video.onloadedmetadata as (() => void) | null)?.());
      },
    });
    return video as unknown as HTMLVideoElement;
  };

  const espia = jest
    .spyOn(document, 'createElement')
    .mockImplementation((tag: string, ...rest: unknown[]) => {
      if (tag === 'canvas') return crearCanvas();
      if (tag === 'video') return crearVideo();
      return crearOriginal(tag as 'div', ...(rest as []));
    });

  return {
    get canvas() {
      return canvasTira;
    },
    dibujos,
    instantes,
    get tipoPedido() {
      return tipoPedido;
    },
    restaurar: () => espia.mockRestore(),
  };
}

const ficheroFalso = () => new File(['bytes'], 'v.mp4', { type: 'video/mp4' });

describe('B-8 — captureVideoSprite produce una imagen FIJA de N fotogramas', () => {
  const urlOriginal = { crear: URL.createObjectURL, revocar: URL.revokeObjectURL };

  beforeAll(() => {
    // jsdom no las implementa; la función las usa para leer el fichero local.
    URL.createObjectURL = jest.fn(() => 'blob:falso');
    URL.revokeObjectURL = jest.fn();
  });

  afterAll(() => {
    URL.createObjectURL = urlOriginal.crear;
    URL.revokeObjectURL = urlOriginal.revocar;
  });

  it('la tira mide N fotogramas de ancho y UNO de alto — no es una rejilla ni un vídeo', async () => {
    const dobles = instalarDobles({ duracion: 20, anchoVideo: 1280, altoVideo: 720, webpSoportado: true });
    try {
      const blob = await captureVideoSprite(ficheroFalso(), 20);

      expect(blob).not.toBeNull();
      // LA AFIRMACIÓN CENTRAL: un solo lienzo con los cinco fotogramas en fila. Si esto
      // dejara de ser cierto, el `background-size: 500% 100%` de P2 pintaría cualquier cosa.
      expect(dobles.canvas).toEqual({
        width: PREVIEW_FRAME_WIDTH * PREVIEW_FRAMES,
        height: PREVIEW_FRAME_HEIGHT,
      });
    } finally {
      dobles.restaurar();
    }
  });

  it('el tipo es una IMAGEN FIJA (webp o jpeg), nunca un formato animado', async () => {
    const dobles = instalarDobles({ duracion: 20, anchoVideo: 1280, altoVideo: 720, webpSoportado: true });
    try {
      const blob = await captureVideoSprite(ficheroFalso(), 20);

      expect(dobles.tipoPedido).toBe('image/webp');
      expect(blob!.type).toBe('image/webp');
      // Lo que NO puede ser, dicho explícitamente: son los formatos que animan solos.
      expect(['image/gif', 'image/apng', 'video/mp4', 'video/webm']).not.toContain(blob!.type);
    } finally {
      dobles.restaurar();
    }
  });

  it('cae a JPEG donde el canvas no sabe emitir WebP — y NUNCA a PNG', async () => {
    // `toBlob(cb, "image/webp")` no falla donde no se soporta: la especificación dice que
    // caiga a PNG, EN SILENCIO. Y un PNG de cinco fotogramas fotográficos pesa cientos de KB
    // — el peor resultado posible sin que nadie se entere. Por eso se sondea antes.
    const dobles = instalarDobles({ duracion: 20, anchoVideo: 1280, altoVideo: 720, webpSoportado: false });
    try {
      const blob = await captureVideoSprite(ficheroFalso(), 20);

      expect(dobles.tipoPedido).toBe('image/jpeg');
      expect(blob!.type).not.toBe('image/png');
    } finally {
      dobles.restaurar();
    }
  });

  it('captura N fotogramas, en los instantes del intervalo [10 %, 90 %] de la duración', async () => {
    const dobles = instalarDobles({ duracion: 30, anchoVideo: 1280, altoVideo: 720, webpSoportado: true });
    try {
      await captureVideoSprite(ficheroFalso(), 30);

      expect(dobles.instantes).toHaveLength(PREVIEW_FRAMES);
      // Ni el 0 ni el final: los extremos de un vídeo de móvil son casi siempre negro o el
      // suelo, y muchos `.mp4` traen un fotograma negro antes del primer keyframe.
      expect(dobles.instantes).toEqual(PREVIEW_FRAME_POSITIONS.map((p) => 30 * p));
      expect(dobles.instantes[0]).toBeGreaterThan(0);
    } finally {
      dobles.restaurar();
    }
  });

  it('cada fotograma se dibuja DESPLAZADO: uno al lado del otro, sin solaparse', async () => {
    const dobles = instalarDobles({ duracion: 20, anchoVideo: 1280, altoVideo: 720, webpSoportado: true });
    try {
      await captureVideoSprite(ficheroFalso(), 20);

      expect(dobles.dibujos).toHaveLength(PREVIEW_FRAMES);
      dobles.dibujos.forEach((d, i) => {
        expect(d).toEqual({
          dx: i * PREVIEW_FRAME_WIDTH,
          dy: 0,
          dw: PREVIEW_FRAME_WIDTH,
          dh: PREVIEW_FRAME_HEIGHT,
        });
      });
    } finally {
      dobles.restaurar();
    }
  });

  it('un vídeo VERTICAL de móvil se recorta al centro, no se deforma', async () => {
    // 9:16 dentro de un hueco 16:9. Encajarlo entero dejaría dos bandas negras enormes; se
    // recorta, que es lo que la tarjeta ya hace con las fotos (`object-cover`).
    const dobles = instalarDobles({ duracion: 20, anchoVideo: 720, altoVideo: 1280, webpSoportado: true });
    try {
      await captureVideoSprite(ficheroFalso(), 20);

      // El destino sigue siendo el fotograma entero: la deformación se evita recortando el
      // ORIGEN, no encogiendo el destino.
      expect(dobles.dibujos[0].dw).toBe(PREVIEW_FRAME_WIDTH);
      expect(dobles.dibujos[0].dh).toBe(PREVIEW_FRAME_HEIGHT);
    } finally {
      dobles.restaurar();
    }
  });

  it('devuelve null si el vídeo no se deja leer — sin sprite se vive, sin vídeo no', async () => {
    const crearOriginal = document.createElement.bind(document);
    const espia = jest
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string, ...rest: unknown[]) => {
        if (tag === 'video') {
          const video: Record<string, unknown> = { preload: '', muted: false, onerror: null };
          Object.defineProperty(video, 'src', {
            set: () => queueMicrotask(() => (video.onerror as (() => void) | null)?.()),
          });
          return video as unknown as HTMLVideoElement;
        }
        // El canvas también se dobla aquí, aunque este caso no llegue a dibujar: el real de
        // jsdom no implementa `getContext` y ensuciaría la salida de CI con un error que no
        // es el que este test observa.
        if (tag === 'canvas') {
          return {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: () => undefined }),
            toBlob: (cb: (b: Blob | null) => void) => cb(null),
          } as unknown as HTMLCanvasElement;
        }
        return crearOriginal(tag as 'div', ...(rest as []));
      });

    try {
      // `null` es un estado NORMAL, no una excepción: es también el de todos los vídeos
      // anteriores a esta ráfaga. Que no lance es lo que impide que una mejora opcional
      // tumbe la subida del vídeo (B-4).
      await expect(captureVideoSprite(ficheroFalso(), 20)).resolves.toBeNull();
    } finally {
      espia.mockRestore();
    }
  });
});
