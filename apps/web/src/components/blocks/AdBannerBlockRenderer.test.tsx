import { render, screen } from '@testing-library/react';
import type { AdBannerBlock } from '@/types/blocks';
import { AdBannerBlockRenderer } from './AdBannerBlockRenderer';

/**
 * PUBLICIDAD EXTERNA — las barreras del render.
 *
 * LA QUE SOSTIENE TODO ES EL `rel`. Un `target="_blank"` sin `noopener` le entrega a la
 * página de destino un `window.opener` con el que puede reescribir la nuestra —tabnabbing—, y
 * en un bloque de PUBLICIDAD el destino es, por definición, de un tercero. El interruptor del
 * editor decide DÓNDE se abre; el `rel` no se elige, y aquí se comprueba que no hay
 * combinación de campos que lo quite.
 */

const IMAGEN = `${process.env.NEXT_PUBLIC_S3_PUBLIC_URL ?? 'http://localhost:9000/marketplace'}/blocks/banner.jpg`;

function banner(extra: Partial<AdBannerBlock> = {}): AdBannerBlock {
  return { id: 'b1', type: 'adBanner', image: { url: IMAGEN }, ...extra };
}

describe('AdBannerBlockRenderer — la imagen y los opcionales', () => {
  it('con SOLO la imagen no pinta ni un hueco: sin textos y sin botón', () => {
    const { container } = render(<AdBannerBlockRenderer block={banner()} />);

    expect(container.querySelector('img')).toHaveAttribute('src', IMAGEN);
    // Ni caja de textos, ni enlace: los opcionales ausentes no dejan restos.
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });

  it('sin `alt` propio cae al título; sin ninguno de los dos, se declara DECORATIVA', () => {
    const { container: conTitulo } = render(
      <AdBannerBlockRenderer block={banner({ title: 'Una oferta' })} />,
    );
    expect(conTitulo.querySelector('img')).toHaveAttribute('alt', 'Una oferta');

    const { container: pelado } = render(<AdBannerBlockRenderer block={banner()} />);
    // `alt=""` y no ausente: es lo que hace que un lector de pantalla la ignore en vez de
    // leer el nombre del fichero.
    expect(pelado.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('una imagen que no es de nuestro almacenamiento no monta NADA', () => {
    const { container } = render(
      <AdBannerBlockRenderer block={banner({ image: { url: 'https://evil.example.com/x.jpg' } })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('el botón necesita las DOS cosas: texto y destino', () => {
    // Con texto y sin enlace no hay dónde ir; con enlace y sin texto no hay qué leer. El
    // esquema no rechaza ese estado a medias a propósito — el render simplemente no lo pinta.
    const soloTexto = render(<AdBannerBlockRenderer block={banner({ ctaLabel: 'Ver' })} />);
    expect(soloTexto.container.querySelectorAll('a')).toHaveLength(0);

    const soloHref = render(<AdBannerBlockRenderer block={banner({ href: '/publicar' })} />);
    expect(soloHref.container.querySelectorAll('a')).toHaveLength(0);

    render(<AdBannerBlockRenderer block={banner({ ctaLabel: 'Ver', href: '/publicar' })} />);
    expect(screen.getByRole('link', { name: 'Ver' })).toBeInTheDocument();
  });

  it('pinta título y descripción cuando están', () => {
    render(<AdBannerBlockRenderer block={banner({ title: 'Título', description: 'Desc' })} />);
    expect(screen.getByText('Título')).toBeInTheDocument();
    expect(screen.getByText('Desc')).toBeInTheDocument();
  });
});

describe('AdBannerBlockRenderer — el enlace: dónde abre y con qué `rel`', () => {
  /** Todas las combinaciones de destino × interruptor. El `rel` de seguridad no falta en ninguna. */
  const casos: { nombre: string; href: string; openInNewTab?: boolean; nueva: boolean }[] = [
    { nombre: 'externo, por defecto', href: 'https://ejemplo.com/x', nueva: true },
    { nombre: 'externo, forzado a nueva', href: 'https://ejemplo.com/x', openInNewTab: true, nueva: true },
    { nombre: 'externo, forzado a la MISMA', href: 'https://ejemplo.com/x', openInNewTab: false, nueva: false },
    { nombre: 'interno, por defecto', href: '/publicar', nueva: false },
    { nombre: 'interno, forzado a nueva', href: '/publicar', openInNewTab: true, nueva: true },
    { nombre: 'interno, forzado a la misma', href: '/publicar', openInNewTab: false, nueva: false },
  ];

  it.each(casos)('$nombre → target y rel correctos', ({ href, openInNewTab, nueva }) => {
    render(<AdBannerBlockRenderer block={banner({ ctaLabel: 'Ir', href, openInNewTab })} />);
    const enlace = screen.getByRole('link', { name: 'Ir' });

    if (nueva) {
      expect(enlace).toHaveAttribute('target', '_blank');
      // LA BARRERA. Sin `noopener`, la página de destino puede reescribir la nuestra.
      expect(enlace.getAttribute('rel')).toContain('noopener');
      expect(enlace.getAttribute('rel')).toContain('noreferrer');
    } else {
      expect(enlace).not.toHaveAttribute('target');
    }
  });

  it('el `rel="sponsored"` del bloque NO desplaza a los de seguridad, se suma', () => {
    // Antes, el `{...rest}` de SmartLink iba después de `rel`, así que un consumidor que
    // pasara `rel` se llevaba por delante el `noopener` sin enterarse. Ahora se componen.
    render(
      <AdBannerBlockRenderer
        block={banner({ ctaLabel: 'Ir', href: 'https://ejemplo.com/x', openInNewTab: true })} />,
    );
    const rel = screen.getByRole('link', { name: 'Ir' }).getAttribute('rel') ?? '';

    expect(rel.split(/\s+/)).toEqual(expect.arrayContaining(['sponsored', 'noopener', 'noreferrer']));
  });

  it('un enlace publicitario lleva `sponsored` aunque abra en la MISMA pestaña', () => {
    render(
      <AdBannerBlockRenderer
        block={banner({ ctaLabel: 'Ir', href: 'https://ejemplo.com/x', openInNewTab: false })} />,
    );
    expect(screen.getByRole('link', { name: 'Ir' }).getAttribute('rel')).toContain('sponsored');
  });
});
