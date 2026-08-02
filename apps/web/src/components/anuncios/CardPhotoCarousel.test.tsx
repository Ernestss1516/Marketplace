// BUGFIX (post-RÁFAGA 2) — el visor de fotos (PhotoLightbox) se renderizaba
// dentro del <a> que envuelve toda la card (ListingCard/ListingCardWide), así
// que cualquier click dentro del visor podía terminar navegando a la ficha del
// anuncio (confirmado en vivo: el botón "Cerrar", con stopPropagation pero SIN
// preventDefault, seguía navegando — la navegación de un <a> es la acción por
// defecto del navegador, no algo que stopPropagation por sí solo evite).
//
// LA CURA: PhotoLightbox se monta con createPortal en document.body, fuera del
// <a> por completo. Este test prueba exactamente eso — que ningún click dentro
// del visor llega al listener del <a> padre — en vez de solo repetir el parche
// (stopPropagation) que ya demostró no ser suficiente.
import { fireEvent, render, screen, within } from '@testing-library/react';
import Link from 'next/link';
import { CardPhotoCarousel } from './CardPhotoCarousel';

const IMAGES = ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg'];

// El envoltorio es <Link>, no un <a> plano, porque eso es LO QUE HAY EN PRODUCCIÓN:
// ListingCard/ListingCardWide envuelven toda la card en <Link href={`/anuncio/${slug}`}>.
// `onAnchorClick` hace de doble del manejador interno con el que Next <Link> navega —
// exactamente el que este bug disparaba (ver cabecera y PhotoLightbox.tsx). <Link>
// renderiza un <a> y reenvía onClick a ese mismo nodo, así que el mecanismo de la
// prueba es idéntico al del <a> plano que había antes, solo que un paso más cerca
// de producción. No hace falta montar el router: ningún click llega nunca al ancla,
// que es justo lo que se afirma aquí.
function renderInsideAnchor(onAnchorClick: () => void) {
  return render(
    <Link href="/anuncio/test" onClick={onAnchorClick} data-testid="card-link">
      <CardPhotoCarousel images={IMAGES} title="Anuncio de prueba" sizes="200px" />
    </Link>,
  );
}

describe('CardPhotoCarousel + PhotoLightbox — el visor no vive dentro del <a> (portal)', () => {
  // CONTROL NEGATIVO del propio fixture. Todo lo de abajo se apoya en
  // `expect(onAnchorClick).not.toHaveBeenCalled()`, que pasaría igual de bien si el
  // spy no llegara a estar cableado al ancla — siete afirmaciones convertidas en
  // no-ops sin que nada se pusiera rojo. Esto fija que el cableado existe: si <Link>
  // dejara de reenviar onClick, ESTE test cae y el resto no miente en silencio.
  it('control: un click DIRECTO en el ancla SÍ dispara su onClick (el spy está cableado)', () => {
    const onAnchorClick = jest.fn();
    renderInsideAnchor(onAnchorClick);

    const anchor = screen.getByTestId('card-link');
    expect(anchor.tagName).toBe('A');

    fireEvent.click(anchor);

    expect(onAnchorClick).toHaveBeenCalled();
  });

  it('el visor se monta en document.body, no como descendiente del <a>', () => {
    renderInsideAnchor(jest.fn());
    fireEvent.click(screen.getByTestId('card-photo-open-lightbox'));

    const lightbox = screen.getByTestId('photo-lightbox');
    expect(lightbox.parentElement).toBe(document.body);

    const anchor = screen.getByTestId('card-link');
    expect(anchor.contains(lightbox)).toBe(false);
  });

  it('abrir el visor NO dispara el onClick del <a> padre', () => {
    const onAnchorClick = jest.fn();
    renderInsideAnchor(onAnchorClick);

    fireEvent.click(screen.getByTestId('card-photo-open-lightbox'));

    expect(screen.getByTestId('photo-lightbox')).toBeInTheDocument();
    expect(onAnchorClick).not.toHaveBeenCalled();
  });

  it('cerrar con el botón X NO dispara el onClick del <a> padre (el bug original: navegaba)', () => {
    const onAnchorClick = jest.fn();
    renderInsideAnchor(onAnchorClick);
    fireEvent.click(screen.getByTestId('card-photo-open-lightbox'));

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(screen.queryByTestId('photo-lightbox')).not.toBeInTheDocument();
    expect(onAnchorClick).not.toHaveBeenCalled();
  });

  it('click en el fondo (backdrop) cierra el visor sin disparar el <a>', () => {
    const onAnchorClick = jest.fn();
    renderInsideAnchor(onAnchorClick);
    fireEvent.click(screen.getByTestId('card-photo-open-lightbox'));

    fireEvent.click(screen.getByTestId('photo-lightbox'));

    expect(screen.queryByTestId('photo-lightbox')).not.toBeInTheDocument();
    expect(onAnchorClick).not.toHaveBeenCalled();
  });

  it('Escape cierra el visor sin disparar el <a>', () => {
    const onAnchorClick = jest.fn();
    renderInsideAnchor(onAnchorClick);
    fireEvent.click(screen.getByTestId('card-photo-open-lightbox'));

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('photo-lightbox')).not.toBeInTheDocument();
    expect(onAnchorClick).not.toHaveBeenCalled();
  });

  it('flecha "siguiente" del visor pasa de foto sin disparar el <a>', () => {
    const onAnchorClick = jest.fn();
    renderInsideAnchor(onAnchorClick);
    fireEvent.click(screen.getByTestId('card-photo-open-lightbox'));

    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    // Scoped to the lightbox: the card's OWN carousel arrow shares the same aria-label.
    fireEvent.click(within(screen.getByTestId('photo-lightbox')).getByRole('button', { name: 'Foto siguiente' }));

    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(onAnchorClick).not.toHaveBeenCalled();
  });

  it('teclado ArrowRight/ArrowLeft navega las fotos sin disparar el <a>', () => {
    const onAnchorClick = jest.fn();
    renderInsideAnchor(onAnchorClick);
    fireEvent.click(screen.getByTestId('card-photo-open-lightbox'));

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByText('2 / 3')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(onAnchorClick).not.toHaveBeenCalled();
  });

  describe('carrusel EN la card (no el visor) — ya funcionaba, sigue funcionando', () => {
    it('flecha "siguiente" del carrusel de la card no dispara el <a> (preventDefault + stopPropagation ya presentes)', () => {
      const onAnchorClick = jest.fn();
      renderInsideAnchor(onAnchorClick);

      fireEvent.click(screen.getByTestId('card-photo-next'));

      expect(onAnchorClick).not.toHaveBeenCalled();
      expect(screen.queryByTestId('photo-lightbox')).not.toBeInTheDocument();
    });

    it('un punto indicador cambia de foto sin disparar el <a>', () => {
      const onAnchorClick = jest.fn();
      renderInsideAnchor(onAnchorClick);

      fireEvent.click(screen.getByTestId('card-photo-dot-2'));
      fireEvent.click(screen.getByTestId('card-photo-open-lightbox'));

      expect(screen.getByText('3 / 3')).toBeInTheDocument();
      expect(onAnchorClick).not.toHaveBeenCalled();
    });
  });
});
