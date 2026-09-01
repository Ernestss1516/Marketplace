// FLECOS DEL VÍDEO #13 y #14 — el indicador en línea y el reproductor compartido.
//
// El #11 (el aviso del asistente) tiene su propio fichero junto al asistente.

import { render, screen } from '@testing-library/react';
import { VideoIndicator } from './VideoIndicator';
import { VideoPlayer } from '@/components/media/VideoPlayer';
import { AvisoVideo } from '../publicar/AvisoVideo';

// `isSafeSrc` mira los dominios configurados; se fija uno para que el test no dependa del
// entorno. Es el MISMO mecanismo que protege a `next/image`.
jest.mock('@/lib/image-domains', () => ({
  isSafeSrc: (url: string) => url.startsWith('https://cdn.marketplace.test/'),
}));

const BUENA = 'https://cdn.marketplace.test/listing-videos/x/v.mp4';
const AJENA = 'https://evil.example.com/v.mp4';

describe('#13 — VideoIndicator en línea (la tabla del backoffice)', () => {
  it('es EL MISMO indicador: mismo testid y mismo texto que sobre una foto', () => {
    const { unmount } = render(<VideoIndicator />);
    const sobreFoto = screen.getByTestId('card-tiene-video').textContent;
    unmount();

    render(<VideoIndicator inline />);
    expect(screen.getByTestId('card-tiene-video')).toHaveTextContent('Vídeo');
    expect(screen.getByTestId('card-tiene-video').textContent).toBe(sobreFoto);
  });

  it('en línea NO se posiciona en absoluto: en una celda de tabla no hay foto debajo', () => {
    render(<VideoIndicator inline />);
    const clases = screen.getByTestId('card-tiene-video').className;

    expect(clases).toContain('inline-flex');
    expect(clases).not.toContain('absolute');
  });

  it('sobre una foto sigue siendo absoluto, como siempre', () => {
    render(<VideoIndicator />);
    const clases = screen.getByTestId('card-tiene-video').className;

    expect(clases).toContain('absolute');
    expect(clases).not.toContain('inline-flex');
  });
});

describe('#14 — VideoPlayer, uno para las dos superficies', () => {
  it('LA MUTACIÓN: siempre `preload="none"`, venga de donde venga', () => {
    // El del backoffice no lo llevaba, así que precargaba el vídeo en CADA apertura de la
    // ficha — se viniera a verlo o a cambiar el estado. Con un componente no hay dónde
    // volver a olvidarlo.
    const { container } = render(<VideoPlayer src={BUENA} />);
    const video = container.querySelector('video');

    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('preload', 'none');
    expect(video).toHaveAttribute('controls');
    // Sin `autoPlay`: reproducir es siempre un acto de quien mira.
    expect(video).not.toHaveAttribute('autoplay');
  });

  it('LA OTRA MUTACIÓN: una dirección ajena no se monta — un `<video src>` no pasa por `remotePatterns`', () => {
    // Ésta es la divergencia que de verdad importaba: la ficha pública validaba el origen
    // y el backoffice pintaba la URL en crudo.
    const { container } = render(<VideoPlayer src={AJENA} />);

    expect(container.querySelector('video')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('un póster de origen ajeno se descarta sin llevarse por delante el vídeo', () => {
    const { container } = render(<VideoPlayer src={BUENA} poster={AJENA} />);
    const video = container.querySelector('video');

    expect(video).not.toBeNull();
    expect(video).not.toHaveAttribute('poster');
  });

  it('el póster bueno sí viaja', () => {
    const poster = 'https://cdn.marketplace.test/listing-videos/x/p.jpg';
    const { container } = render(<VideoPlayer src={BUENA} poster={poster} />);

    expect(container.querySelector('video')).toHaveAttribute('poster', poster);
  });
});

describe('#11 — el aviso del asistente de publicar', () => {
  it('a un PRO se le dice DÓNDE, sin venderle nada que ya tiene', () => {
    render(<AvisoVideo isPro />);

    expect(screen.getByTestId('aviso-video-pro')).toHaveTextContent(/editar/i);
    expect(screen.queryByTestId('aviso-video-no-pro')).not.toBeInTheDocument();
    // Un enlace a /planes a quien ya paga es ruido, y sugiere que le falta algo.
    expect(screen.queryByRole('link', { name: /Ver Pro/i })).not.toBeInTheDocument();
  });

  it('LA MUTACIÓN: a un NO-Pro se le cuenta la ventaja, con su salida a /planes', () => {
    // Sin la rama del gate, el asistente no le diría nada a quien hay que convencer — que
    // es precisamente para quien el vídeo tiene que existir.
    render(<AvisoVideo isPro={false} />);

    const pista = screen.getByTestId('aviso-video-no-pro');
    expect(pista).toHaveTextContent(/vídeo/i);
    expect(screen.getByRole('link', { name: /Ver Pro/i })).toHaveAttribute('href', '/planes');
    expect(screen.queryByTestId('aviso-video-pro')).not.toBeInTheDocument();
  });

  it('CERO BYTES: el aviso no monta ningún `<video>` ni trae una dirección de medios', () => {
    const { container } = render(<AvisoVideo isPro />);

    expect(container.querySelector('video')).toBeNull();
    // Ni `<video>`, ni `<source>`, ni una URL de medios. NO se afirma «no aparece la
    // cadena http» a secas: el icono de lucide es un SVG y trae su `xmlns`, que es un
    // http legítimo y no una descarga. Lo que importa es que no haya nada que BAJAR.
    expect(container.querySelector('source')).toBeNull();
    expect(container.innerHTML).not.toMatch(/listing-videos|\.mp4/);
  });
});
