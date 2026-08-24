/**
 * EL INDICADOR DE VÍDEO EN LAS DOS TARJETAS DEL MAPA.
 *
 * Eran las dos últimas superficies sin indicador. Recibían `hasVideo` en el dato —viene del
 * documento de Meilisearch como en cualquier otra tarjeta— pero son marcado propio, no pasan
 * por `CardPhotoCarousel`, y nadie lo pintaba.
 *
 * Y no se notaba porque no se podía notar: vivían dentro de `MapView`, que importa
 * `maplibre-gl` y monta un canvas WebGL, así que ninguna prueba podía llegar a ellas sin
 * levantar un mapa. Sacarlas a `MapCards.tsx` es lo que hace posible esta batería — la
 * ausencia de barrera fue parte del defecto, no un accidente aparte.
 *
 * Ver docs/auditoria-pro-video.md §2.3 (hueco V-3).
 */
import { render, screen, cleanup } from '@testing-library/react';
import { FloatingCard, SelectedListingPanel } from './MapCards';
import type { ListingSummary } from '@/types';

const BASE = {
  id: 'l1',
  title: 'Anuncio en el mapa',
  slug: 'anuncio-en-el-mapa',
  price: 250,
  currency: 'EUR',
  priceType: 'FIXED',
  status: 'ACTIVE',
  type: 'PRODUCT',
  city: 'Valencia',
  province: 'Valencia',
  thumbnailUrl: 'http://localhost:9000/marketplace/a.jpg',
} as ListingSummary;

const flotante = (hasVideo: boolean) =>
  render(
    <FloatingCard
      listing={{ ...BASE, hasVideo }}
      pos={{ x: 200, y: 200 }}
      containerW={800}
      onClose={jest.fn()}
    />,
  );

const panel = (hasVideo: boolean) =>
  render(
    <SelectedListingPanel
      listing={{ ...BASE, hasVideo }}
      attributeMap={{}}
      onClose={jest.fn()}
    />,
  );

afterEach(cleanup);

describe('FloatingCard — la tarjeta flotante sobre el marcador', () => {
  it('con vídeo pinta el indicador', () => {
    flotante(true);
    expect(screen.getByTestId('card-tiene-video')).toBeInTheDocument();
  });

  it('sin vídeo no pinta nada', () => {
    flotante(false);
    expect(screen.queryByTestId('card-tiene-video')).not.toBeInTheDocument();
  });

  it('COMPACTO: la miniatura mide 56 px, así que va sin la palabra pero con nombre accesible', () => {
    // La píldora completa se saldría de una miniatura de 56 px. Es el MISMO indicador —
    // mismo componente, mismo testid—, sólo que sin texto; y sin texto el nombre accesible
    // deja de ser opcional.
    flotante(true);
    const indicador = screen.getByTestId('card-tiene-video');
    expect(indicador).not.toHaveTextContent('Vídeo');
    expect(indicador).toHaveAttribute('aria-label', 'Tiene vídeo');
  });

  it('CERO BYTES: no monta ningún <video>', () => {
    const { container } = flotante(true);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('source')).toBeNull();
  });

  it('y la tarjeta sigue siendo un enlace al anuncio', () => {
    // El indicador es `pointer-events-none`: añadirlo no puede robarle el clic a la tarjeta.
    flotante(true);
    expect(screen.getByTestId('map-float-link')).toHaveAttribute(
      'href',
      '/anuncio/anuncio-en-el-mapa',
    );
  });
});

describe('SelectedListingPanel — el panel de debajo del mapa', () => {
  it('con vídeo pinta el indicador, y aquí SÍ con la palabra: hay sitio', () => {
    // 130×100 px dan de sobra para la píldora completa, así que este panel no necesita la
    // variante compacta. Misma decisión que en el resto de superficies grandes.
    panel(true);
    expect(screen.getByTestId('card-tiene-video')).toHaveTextContent('Vídeo');
  });

  it('sin vídeo no pinta nada', () => {
    panel(false);
    expect(screen.queryByTestId('card-tiene-video')).not.toBeInTheDocument();
  });

  it('CERO BYTES: tampoco aquí', () => {
    const { container } = panel(true);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('source')).toBeNull();
  });

  it('REQUISITO DE ORO: el panel sigue enseñando lo de siempre', () => {
    // Envolver la miniatura en un contenedor `relative` para colocar el indicador no puede
    // llevarse por delante lo que el panel ya pintaba.
    panel(true);
    expect(screen.getByText('Anuncio en el mapa')).toBeInTheDocument();
    expect(screen.getByText('Valencia, Valencia')).toBeInTheDocument();
    expect(screen.getByTestId('map-detail-link')).toHaveAttribute(
      'href',
      '/anuncio/anuncio-en-el-mapa',
    );
  });
});
