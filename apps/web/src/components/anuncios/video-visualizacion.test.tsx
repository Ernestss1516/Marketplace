/**
 * Vídeo Pro, ráfaga 3 — lo que se PINTA en cada superficie.
 *
 * Las dos garantías del diseño, fijadas donde se pueden comprobar de verdad:
 *   · en LISTAS no se monta ningún elemento de vídeo, solo un indicador;
 *   · en la FICHA el reproductor va con `preload="none"`, así que el fichero no se pide
 *     hasta que alguien pulsa play.
 */
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CardPhotoCarousel } from './CardPhotoCarousel';
import { ListingGallery } from './ListingGallery';
import { VideoIndicator } from './VideoIndicator';

afterEach(cleanup);

describe('CardPhotoCarousel — el indicador de vídeo en las listas', () => {
  const base = {
    images: ['https://localhost:9000/marketplace/a.jpg'],
    title: 'Un anuncio',
    sizes: '100px',
  };

  it('con vídeo pinta el indicador', () => {
    render(<CardPhotoCarousel {...base} hasVideo />);
    expect(screen.getByTestId('card-tiene-video')).toBeInTheDocument();
  });

  it('sin vídeo NO pinta nada: las tarjetas de siempre no cambian', () => {
    render(<CardPhotoCarousel {...base} />);
    expect(screen.queryByTestId('card-tiene-video')).not.toBeInTheDocument();
  });

  it('CERO BYTES DE VÍDEO: no se monta ningún <video> en una tarjeta', () => {
    const { container } = render(<CardPhotoCarousel {...base} hasVideo />);

    // El riesgo central de la auditoría era reproducir vídeo en listas. Aquí se comprueba
    // que ni siquiera existe el elemento: sin `<video>` no hay `preload`, ni metadatos, ni
    // una sola petición. El indicador es un SVG del bundle.
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('source')).toBeNull();
  });

  it('y el indicador no roba el clic de la tarjeta', () => {
    render(<CardPhotoCarousel {...base} hasVideo />);
    // `pointer-events-none`: la tarjeta entera sigue siendo un enlace al anuncio.
    expect(screen.getByTestId('card-tiene-video').className).toContain('pointer-events-none');
  });
});

/**
 * UN SOLO INDICADOR PARA LAS CUATRO SUPERFICIES.
 *
 * El `<span>` vivía escrito a mano dentro de `CardPhotoCarousel`, así que las superficies
 * que NO pasan por ese carrusel —la tarjeta de «Mis anuncios» y las dos del mapa— no tenían
 * indicador aunque recibían `hasVideo`. Copiarlo tres veces habría creado tres sitios donde
 * el icono, el texto o el `data-testid` pueden separarse; se extrajo a `VideoIndicator`.
 *
 * Lo que estos casos fijan es lo que la extracción NO puede perder por el camino.
 */
describe('VideoIndicator — el indicador compartido', () => {
  it('dice «Vídeo» y lleva el testid que las cuatro superficies comparten', () => {
    render(<VideoIndicator />);
    const indicador = screen.getByTestId('card-tiene-video');
    expect(indicador).toHaveTextContent('Vídeo');
    expect(indicador.className).toContain('pointer-events-none');
  });

  it('CERO BYTES: tampoco aquí se monta nada que descargue vídeo', () => {
    // La garantía, comprobada en el componente y no sólo en sus llamantes: sea cual sea la
    // superficie que lo use, esto no puede pedir un fichero porque no recibe ninguna
    // dirección — su contrato entero son dos props de presentación.
    const { container } = render(<VideoIndicator />);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('source')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('en compacto pierde el texto pero NO el nombre accesible ni el testid', () => {
    // La miniatura del mapa mide 56 px y la píldora con la palabra se saldría. Que el texto
    // desaparezca no puede dejar el indicador mudo para un lector de pantalla.
    render(<VideoIndicator compact />);
    const indicador = screen.getByTestId('card-tiene-video');
    expect(indicador).not.toHaveTextContent('Vídeo');
    expect(indicador).toHaveAttribute('aria-label', 'Tiene vídeo');
  });

  it('la posición es del que lo coloca, la apariencia es suya', () => {
    // Cada superficie tiene su miniatura y su tamaño, así que la posición se pasa; lo que
    // NO se pasa —ni se puede cambiar desde fuera— es qué dice y cómo se identifica.
    render(<VideoIndicator className="bottom-1 right-1" />);
    expect(screen.getByTestId('card-tiene-video').className).toContain('bottom-1 right-1');
  });
});

// La tarjeta de «Mis anuncios» necesita media docena de mocks (sesión, router, sonner, dos
// clientes de API), así que su barrera vive aparte para no arrastrarlos a este fichero, que
// prueba componentes puros: `mis-anuncios-indicador-video.test.tsx`.

describe('ListingGallery — el reproductor de la ficha', () => {
  const propio = 'http://localhost:9000/marketplace';
  const imagenes = [{ url: `${propio}/foto1.jpg` }, { url: `${propio}/foto2.jpg` }] as never;

  it('sin vídeo, la galería es exactamente la de antes', () => {
    const { container } = render(<ListingGallery images={imagenes} title="Anuncio" />);

    expect(container.querySelector('video')).toBeNull();
    expect(screen.queryByTestId('ficha-video-miniatura')).not.toBeInTheDocument();
  });

  it('con vídeo aparece una miniatura MÁS, después de las fotos', () => {
    render(
      <ListingGallery
        images={imagenes}
        title="Anuncio"
        videoUrl={`${propio}/listing-videos/x/v.mp4`}
        videoPosterUrl={`${propio}/p.jpg`}
      />,
    );

    expect(screen.getByTestId('ficha-video-miniatura')).toBeInTheDocument();
    // La foto de portada sigue siendo lo primero que se ve: es la que el vendedor eligió y
    // la que aparece en las listas, así que sustituirla rompería la continuidad.
    expect(screen.queryByTestId('ficha-video')).not.toBeInTheDocument();
  });

  it('al elegir el vídeo, el reproductor va con preload="none"', () => {
    render(
      <ListingGallery
        images={imagenes}
        title="Anuncio"
        videoUrl={`${propio}/listing-videos/x/v.mp4`}
        videoPosterUrl={`${propio}/p.jpg`}
      />,
    );

    fireEvent.click(screen.getByTestId('ficha-video-miniatura'));

    const video = screen.getByTestId('ficha-video');
    // LA DECISIÓN DE RENDIMIENTO DE LA FICHA: ni siquiera al seleccionarlo se descarga. El
    // fichero se pide cuando el usuario pulsa play, no antes.
    expect(video).toHaveAttribute('preload', 'none');
    expect(video).not.toHaveAttribute('autoplay');
    expect(video).toHaveAttribute('poster', `${propio}/p.jpg`);
  });

  it('VALIDACIÓN DE ORIGEN: una URL de otro dominio no se pinta', () => {
    render(
      <ListingGallery
        images={imagenes}
        title="Anuncio"
        videoUrl="https://atacante.example.com/v.mp4"
        videoPosterUrl="https://atacante.example.com/p.jpg"
      />,
    );

    // Un <video src> no pasa por remotePatterns de next/image, así que esta es su única
    // restricción de origen. Sin ella, sería la única media del producto sin ninguna.
    expect(screen.queryByTestId('ficha-video-miniatura')).not.toBeInTheDocument();
  });

  it('sin póster el reproductor cae a la foto de portada, nunca a un rectángulo negro', () => {
    render(
      <ListingGallery
        images={imagenes}
        title="Anuncio"
        videoUrl={`${propio}/listing-videos/x/v.mp4`}
      />,
    );

    fireEvent.click(screen.getByTestId('ficha-video-miniatura'));
    expect(screen.getByTestId('ficha-video')).toHaveAttribute('poster', `${propio}/foto1.jpg`);
  });
});
