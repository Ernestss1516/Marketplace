/**
 * PREVIA DE VÍDEO EN MÓVIL — EL TOQUE.
 *
 * QUÉ CIERRA: la previsualización animada del vídeo existía sólo tras `@media (hover: hover)`,
 * así que en un teléfono —el dispositivo mayoritario de un marketplace— el vídeo Pro no se
 * anunciaba en las listas más allá del icono. El disparador elegido fue el toque sobre el
 * indicador de vídeo, que era ya el affordance correcto y sólo había que activarlo
 * (`docs/diagnostico-previa-video-movil.md`, opción B).
 *
 * EL EJE ES EL RENDIMIENTO, y estas barreras son lo que impide que se pierda por el camino:
 *
 *   · B-1 — CERO BYTES POR DEFECTO. Sin tocar nada, ninguna tarjeta monta la capa. Es la
 *           barrera que separa la opción B (0 KB) de la A (888 KB medidos por página).
 *   · B-2 — EL TOQUE ANUNCIA. Al pulsar el botón, la capa se monta con el sprite y con el
 *           atributo que la anima en táctil.
 *   · B-3 — EL ÁREA TÁCTIL. La píldora mide ~52×20; el botón extiende su zona sensible a
 *           ≥44×44 o el gesto falla justo en el dispositivo objetivo.
 *   · B-4 — ESCRITORIO INTACTO. Sin manejador no hay botón: las tres superficies sin sprite
 *           siguen teniendo el `<span>` inerte de siempre.
 *   · B-5 — LA GARANTÍA. Lo que el toque carga es una IMAGEN. Sigue sin haber `<video>` y la
 *           tarjeta sigue recibiendo un booleano, nunca la dirección del `.mp4`.
 *   · B-6 — UNO Y NO N. Tocar una segunda tarjeta apaga la primera; el segundo toque sobre la
 *           misma la apaga. Nunca hay dos sprites animando.
 *   · B-7 — NO ROBA LA NAVEGACIÓN. La tarjeta entera es un `<Link>`; el botón para el evento
 *           en vez de llevarse al usuario al anuncio.
 */
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import Link from 'next/link';
import { CardPhotoCarousel } from './CardPhotoCarousel';
import { VideoIndicator } from './VideoIndicator';

afterEach(cleanup);

const SPRITE = 'http://localhost:9000/marketplace-test/listing-previews/x/s.webp';

const base = {
  images: ['http://localhost:9000/marketplace-test/media/a.jpg'],
  title: 'Un anuncio con vídeo',
  sizes: '100px',
};

const boton = () => screen.getByTestId('card-tiene-video');
const capa = () => screen.queryByTestId('card-video-preview');

// ═══════════════════════════════════════════════════════════════════════════════
//  B-1 — cero bytes por defecto
// ═══════════════════════════════════════════════════════════════════════════════

describe('B-1 — sin tocar nada, no se descarga ningún sprite', () => {
  it('en el render inicial la capa NO existe, aunque haya sprite y el botón esté puesto', () => {
    render(<CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />);

    /**
     * ES LA BARRERA QUE DEFINE LA OPCIÓN ELEGIDA. La URL del sprite viaja en el payload de la
     * tarjeta (~100 bytes), pero el elemento que la referencia no existe, así que el navegador
     * no pide la imagen. Montar la capa «ya que la URL está» convertiría esto en la opción A
     * del diagnóstico: 6 sprites nada más abrir la página y hasta 888 KB al recorrerla — el
     * coste que esta ráfaga existe para NO pagar.
     */
    expect(capa()).not.toBeInTheDocument();
    // Y el botón sí está: el affordance no cuesta bytes, es un SVG del bundle.
    expect(boton()).toBeInTheDocument();
  });

  it('el botón anuncia lo que hace, no lo que ya hay pintado', () => {
    render(<CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />);

    // Sin la etiqueta, quien navega con lector de pantalla sólo oiría «Vídeo», que describe el
    // ANUNCIO. Lo que necesita saber es que ahí hay un gesto disponible.
    expect(boton()).toHaveAttribute('aria-pressed', 'false');
    expect(boton().getAttribute('aria-label')).toContain('Ver una previsualización');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  B-2 — el toque anuncia el vídeo
// ═══════════════════════════════════════════════════════════════════════════════

describe('B-2 — al tocar el botón, la previsualización se enciende', () => {
  it('monta la capa con el sprite como variable CSS', () => {
    render(<CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />);

    fireEvent.click(boton());

    expect(capa()).toBeInTheDocument();
    expect(capa()!.getAttribute('style')).toContain(SPRITE);
  });

  it('y con `data-tap`, que es lo que la anima donde no hay hover', () => {
    render(<CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />);

    fireEvent.click(boton());

    /**
     * SIN ESTE ATRIBUTO EL CAMBIO NO SIRVE DE NADA, y es un fallo que ningún otro test vería:
     * la capa se montaría (y el sprite se descargaría), pero su única regla de animación vive
     * tras `@media (hover: hover)`, así que en un teléfono se quedaría invisible —`opacity: 0`—
     * después de haber gastado los bytes. El peor de los dos mundos.
     */
    expect(capa()).toHaveAttribute('data-tap', 'true');
    expect(capa()!.className).toContain('sprite-previa');
  });

  it('el botón queda marcado como pulsado y ofrece el gesto contrario', () => {
    render(<CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />);

    fireEvent.click(boton());

    expect(boton()).toHaveAttribute('aria-pressed', 'true');
    expect(boton().getAttribute('aria-label')).toContain('Ocultar');
  });

  it('un segundo toque la apaga — en táctil no existe «salir de la tarjeta»', () => {
    render(<CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />);

    fireEvent.click(boton());
    fireEvent.click(boton());

    // Sin toggle, la única forma de recuperar la foto de portada sería encender OTRA tarjeta
    // o navegar. El gesto tiene que poder deshacerse donde se hizo.
    expect(capa()).not.toBeInTheDocument();
    expect(boton()).toHaveAttribute('aria-pressed', 'false');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  B-3 — el área táctil
// ═══════════════════════════════════════════════════════════════════════════════

describe('B-3 — el botón es tocable de verdad (≥44×44)', () => {
  it('extiende su zona sensible con un pseudo-elemento, sin agrandar la píldora', () => {
    render(<CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />);

    /**
     * LA ARITMÉTICA, PORQUE ES LA RAZÓN DE SER DE LA CLASE. La píldora mide ~52×20 px: bien
     * para no tapar una foto de 173, menos de la mitad del mínimo recomendado para un dedo.
     * `after:-inset-3.5` son 14 px en las cuatro direcciones → 52+28 = 80 de ancho y 20+28 = 48
     * de alto. Por encima de 44×44 en los dos ejes, y la píldora se ve exactamente igual.
     *
     * jsdom no calcula geometría, así que aquí sólo se puede comprobar que la clase que la
     * produce sigue puesta. **La medida de verdad está en `e2e/previa-video-movil.spec.ts`**,
     * que la lee del navegador — y no es una redundancia: la primera versión de este botón
     * llevaba además `relative` y eso lo descolocaba a la esquina contraria, con este test en
     * verde. Las dos clases de posición conviven en jsdom; en un navegador, no.
     */
    expect(boton().className).toContain('after:-inset-3.5');
    // Y NO `relative`: `absolute` (que ya trae el indicador) es lo que posiciona el botón, y
    // añadir el otro lo saca de su esquina. Ver la cicatriz en `VideoIndicator`.
    expect(boton().className).not.toContain('relative');
    expect(boton().className).toContain('absolute');
    // Y recibe eventos: el carrusel apaga los de sus capas decorativas, éste es la excepción.
    expect(boton().className).toContain('pointer-events-auto');
    expect(boton().className).not.toContain('pointer-events-none');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  B-4 — sin sprite que enseñar, no hay botón
// ═══════════════════════════════════════════════════════════════════════════════

describe('B-4 — el botón sólo existe donde hay algo que enseñar', () => {
  it('sin `videoPreviewUrl` el indicador sigue siendo el `<span>` inerte de siempre', () => {
    render(<CardPhotoCarousel {...base} hasVideo />);

    /**
     * EL CASO MAYORITARIO: todos los vídeos anteriores al sprite tienen la columna a `null` y
     * no se pueden regenerar (haría falta ffmpeg). Un botón que al tocarlo no hace nada es
     * peor que no tener botón: el usuario no tiene forma de saber si falló él o la aplicación.
     */
    expect(boton().tagName).toBe('SPAN');
    expect(boton().className).toContain('pointer-events-none');
  });

  it('con un sprite de dominio AJENO tampoco — es la misma pregunta que se hace la capa', () => {
    render(
      <CardPhotoCarousel
        {...base}
        hasVideo
        videoPreviewUrl="https://atacante.example.com/listing-previews/x/s.webp"
      />,
    );

    // `spriteUtilizable` incluye `isSafeSrc`, y por eso se comparte: con dos copias de la
    // condición, ésta sería justo la tarjeta que ofrece un gesto que no puede cumplir.
    expect(boton().tagName).toBe('SPAN');
  });

  it('las superficies sin carrusel (mapa, mis anuncios, backoffice) no cambian', () => {
    // `VideoIndicator` sin `onActivar` — el uso de MyListingCard, MapCards y la tabla del
    // backoffice. Aditivo de verdad: lo que no pide el botón, no lo recibe.
    render(<VideoIndicator />);
    expect(screen.getByTestId('card-tiene-video').tagName).toBe('SPAN');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  B-5 — la garantía: una imagen, nunca el vídeo
// ═══════════════════════════════════════════════════════════════════════════════

describe('B-5 — lo que el toque carga es una IMAGEN', () => {
  it('tras tocar sigue sin haber `<video>` ni `<source>` en la tarjeta', () => {
    const { container } = render(
      <CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />,
    );

    fireEvent.click(boton());

    /**
     * LA FRASE ENTERA DE ESTA VÍA: con una imagen no se puede montar un reproductor. El
     * disparador decide CUÁNDO se pide una imagen; no acerca la dirección del `.mp4` a la
     * tarjeta ni un milímetro. Por eso la previa en móvil no reabre la decisión del vídeo.
     */
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('source')).toBeNull();
  });

  it('la capa se pinta con la URL del sprite, que vive en el prefijo de las previsualizaciones', () => {
    render(<CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />);
    fireEvent.click(boton());

    const estilo = capa()!.getAttribute('style')!;
    expect(estilo).toContain('listing-previews/');
    // El prefijo del vídeo es la cadena literal que el barrido e2e busca para dar por rota la
    // garantía del cero-bytes-en-listas. Aquí no puede aparecer, porque a este componente no
    // le llega: sólo recibe `hasVideo` (booleano) y la URL del sprite.
    expect(estilo).not.toContain('listing-videos/');
  });

  it('el indicador sigue visible por encima de la previsualización', () => {
    render(<CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />);
    fireEvent.click(boton());

    // Lo que anuncia («esto tiene vídeo») sigue siendo cierto mientras se anima — y ahora
    // además es el control para apagarla, así que taparla sería dejar el gesto sin vuelta.
    expect(boton()).toBeInTheDocument();
    expect(capa()).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  B-6 — uno y no N
// ═══════════════════════════════════════════════════════════════════════════════

describe('B-6 — nunca hay dos previsualizaciones animando a la vez', () => {
  it('tocar la segunda tarjeta apaga la primera', () => {
    render(
      <div>
        <CardPhotoCarousel {...base} title="Primera" hasVideo videoPreviewUrl={SPRITE} />
        <CardPhotoCarousel {...base} title="Segunda" hasVideo videoPreviewUrl={SPRITE} />
      </div>,
    );

    const [primero, segundo] = screen.getAllByTestId('card-tiene-video');

    fireEvent.click(primero);
    expect(screen.getAllByTestId('card-video-preview')).toHaveLength(1);

    fireEvent.click(segundo);

    /**
     * EL COSTE QUE ESTO ACOTA. En escritorio la exclusividad la regala el ratón: sólo se puede
     * estar encima de una tarjeta. **Un toque no se va solo**, así que sin coordinación tocar
     * cinco indicadores dejaría cinco sprites descargados y cinco capas animando — la opción A
     * del diagnóstico pagada a plazos, con su jank de scroll incluido.
     */
    const capas = screen.getAllByTestId('card-video-preview');
    expect(capas).toHaveLength(1);
    expect(capas[0].getAttribute('aria-label')).toContain('Segunda');

    // Y el estado de los botones lo refleja: el primero vuelve a ofrecer «ver».
    expect(primero).toHaveAttribute('aria-pressed', 'false');
    expect(segundo).toHaveAttribute('aria-pressed', 'true');
  });

  it('una tarjeta que desaparece suelta su turno — o la siguiente nacería animando', () => {
    const { rerender } = render(
      <div>
        <CardPhotoCarousel key="primera" {...base} title="Primera" hasVideo videoPreviewUrl={SPRITE} />
      </div>,
    );

    fireEvent.click(boton());
    expect(capa()).toBeInTheDocument();

    // Cambio de página o filtro nuevo: la tarjeta encendida se DESMONTA (la `key` cambia) y
    // otra ocupa su sitio.
    rerender(
      <div>
        <CardPhotoCarousel key="otra" {...base} title="Otra" hasVideo videoPreviewUrl={SPRITE} />
      </div>,
    );

    /**
     * EL DEFECTO QUE ESTO CAZA, y no es el que parece a primera vista. `useId` es
     * **posicional**: una tarjeta que se monta en el mismo lugar del árbol recibe el MISMO
     * identificador que la que se fue. Sin soltar el turno al desmontar, el coordinador
     * seguiría apuntando a ese id — y la tarjeta nueva nacería con la capa puesta, animando el
     * sprite de un anuncio que el usuario no ha tocado y gastando sus bytes. O sea, la barrera
     * B-1 rota por la puerta de atrás, en la única situación en la que nadie miraría.
     *
     * Comprobado: sin el `useEffect` de limpieza, aquí aparece la capa con el `aria-label` de
     * «Otra» sin que se haya pulsado nada.
     */
    expect(capa()).not.toBeInTheDocument();

    // Y el gesto sigue funcionando en la tarjeta nueva: soltar el turno no lo inutiliza.
    fireEvent.click(boton());
    expect(capa()).toBeInTheDocument();
    expect(capa()!.getAttribute('aria-label')).toContain('Otra');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  B-7 — el molde de las flechas: un control dentro del enlace
// ═══════════════════════════════════════════════════════════════════════════════

describe('B-7 — el botón no se lleva al usuario al anuncio', () => {
  it('para el evento: `preventDefault` y `stopPropagation`, como las flechas del carrusel', () => {
    const navegar = jest.fn();
    render(
      // El `<a>` es lo que envuelve a la tarjeta en producción (`ListingCard`). Si el botón no
      // parase el evento, tocarlo navegaría al anuncio en vez de encender la previa: el
      // usuario vería su gesto «fallar» llevándoselo a otra pantalla.
      <Link href="/anuncio/x" onClick={navegar}>
        <CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />
      </Link>,
    );

    const evento = fireEvent.click(boton());

    // `fireEvent` devuelve false cuando algún manejador llamó a `preventDefault`.
    expect(evento).toBe(false);
    // Y no llegó arriba: `stopPropagation` corta la burbuja antes del enlace.
    expect(navegar).not.toHaveBeenCalled();
    expect(capa()).toBeInTheDocument();
  });

  it('el resto de la tarjeta sigue navegando', () => {
    const navegar = jest.fn();
    const { container } = render(
      <Link href="/anuncio/x" onClick={navegar}>
        <CardPhotoCarousel {...base} hasVideo videoPreviewUrl={SPRITE} />
      </Link>,
    );

    // Un clic en el chasis de la tarjeta, que NO es el botón: el enlace tiene que seguir
    // siendo el gesto principal. Lo que se añade es un control DENTRO de él, no un sustituto.
    fireEvent.click(container.querySelector('a > div')!);
    expect(navegar).toHaveBeenCalled();
  });
});
