import { render, screen } from '@testing-library/react';
import { SiteBrand } from './SiteBrand';
import { SITE_NAME } from '@/config';

/**
 * TRES LOGOS L2 — EL INTERCAMBIO DEL BLOG (§11.2, opción A) y el respaldo, en el DOM.
 *
 * `brand.test.ts` fija la CADENA; esto fija lo que de verdad se pinta: que con logo sale
 * una `<img>` con su `alt`, que sin logo sale TEXTO —nunca un hueco— y que la ruta
 * decide cuál de los dos logos se usa. La mutación que mata: quitar el intercambio, y
 * entonces `/blog` enseñaría el logo público.
 */

let pathname = '/';
jest.mock('next/navigation', () => ({ usePathname: () => pathname }));

const PUB = 'https://cdn.example/branding/publico.svg';
const BLOG = 'https://cdn.example/branding/blog.webp';

function pintar(ruta: string, logos: { public: string | null; blog: string | null }) {
  pathname = ruta;
  render(<SiteBrand logos={{ backoffice: null, ...logos }} />);
}

describe('SiteBrand — la marca de la cabecera pública', () => {
  it('en /blog pinta el logo del BLOG, no el público', () => {
    pintar('/blog/mi-articulo', { public: PUB, blog: BLOG });
    expect(screen.getByRole('img')).toHaveAttribute('src', BLOG);
  });

  it('fuera del blog pinta el PÚBLICO, aunque haya logo de blog', () => {
    pintar('/busqueda', { public: PUB, blog: BLOG });
    expect(screen.getByRole('img')).toHaveAttribute('src', PUB);
  });

  it('en /blog SIN logo de blog cae al público — la instancia queda coherente', () => {
    pintar('/blog', { public: PUB, blog: null });
    expect(screen.getByRole('img')).toHaveAttribute('src', PUB);
  });

  it('SIN ningún logo la cabecera NO queda vacía: pinta el nombre del sitio', () => {
    pintar('/', { public: null, blog: null });
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(SITE_NAME)).toBeInTheDocument();
  });

  it('el nombre accesible es el MISMO haya logo o no', () => {
    // Es lo que mantiene válidas las pruebas que buscan la cabecera por su nombre
    // (`shell-cuenta.spec.ts`: el enlace «Marketplace») en los dos estados, y lo que
    // hace que quien usa un lector de pantalla oiga lo mismo en ambos.
    pintar('/', { public: PUB, blog: null });
    expect(screen.getByRole('img')).toHaveAttribute('alt', SITE_NAME);
  });
});
