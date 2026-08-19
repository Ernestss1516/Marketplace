/**
 * PUERTA ráfaga 2 — EL AVISO DE REVALIDACIÓN en la tarjeta de gestión.
 *
 * Lo que se fija aquí es la POLÍTICA, no el diseño: el anuncio marcado sigue
 * anunciándose como ACTIVO (porque lo está, y el comprador lo sigue viendo), y
 * el aviso lleva los motivos concretos. Un aviso sin motivos sería un susto sin
 * salida — es la mitigación M6 de la auditoría y la razón de que la puerta
 * devuelva varios motivos y no uno.
 */

import { render, screen, cleanup } from '@testing-library/react';
import { MyListingCard } from './MyListingCard';
import type { BumpPricing, ListingSummary } from '@/types';

jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { slug: 'vendedor', accessToken: 'token-de-prueba' } },
    status: 'authenticated',
  }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
  usePathname: () => '/mis-anuncios',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/lib/api/billing', () => ({
  bumpListing: jest.fn(),
  featuredByCredits: jest.fn(),
  createFeaturedCheckout: jest.fn(),
  getCatalog: jest.fn(() => Promise.resolve({ products: [], bumpCreditCost: 5 })),
  getWallet: jest.fn(() => Promise.resolve({ balance: 0, bumpBalance: 0 })),
  getProStatus: jest.fn(() =>
    Promise.resolve({
      isPro: false,
      limit: 0,
      used: 0,
      remaining: 0,
      bumpQuota: { limit: 0, used: 0, remaining: 0 },
    }),
  ),
}));

jest.mock('@/lib/api/anuncios', () => ({
  publishListing: jest.fn(),
  reserveListing: jest.fn(),
  discardDraft: jest.fn(),
  renewListing: jest.fn(),
  pauseListing: jest.fn(),
  reactivateListing: jest.fn(),
  archiveListing: jest.fn(),
}));

const PRICING: BumpPricing = {
  bumpCreditCost: 5,
  bumpBalance: 0,
  bumpQuota: { limit: 0, used: 0, remaining: 0 },
};

function renderCard(extra: Partial<ListingSummary>) {
  const listing = {
    id: 'listing-1',
    title: 'Anuncio de prueba',
    slug: 'anuncio-de-prueba',
    price: 100,
    currency: 'EUR',
    priceType: 'FIXED',
    status: 'ACTIVE',
    type: 'PRODUCT',
    ...extra,
  } as ListingSummary;

  return render(
    <MyListingCard
      listing={listing}
      token="token-de-prueba"
      onAction={jest.fn()}
      bumpPricing={PRICING}
    />,
  );
}

afterEach(cleanup);

describe('Aviso de revalidación en la tarjeta de gestión', () => {
  it('sin marcar no aparece nada — es el caso normal de todos los anuncios', () => {
    renderCard({});
    expect(screen.queryByTestId('revalidation-notice-listing-1')).toBeNull();
  });

  it('marcado: avisa, LISTA LOS MOTIVOS y dice que sigue publicado', () => {
    renderCard({
      needsRevalidation: true,
      revalidationReasons: [
        { code: 'ATTRIBUTE_REQUIRED_MISSING', field: 'anio', message: 'Falta "Año", que es obligatorio.' },
        { code: 'ATTRIBUTE_UNKNOWN', field: 'viejo', message: '"viejo" ya no es un atributo de esta categoría.' },
      ],
    });

    const aviso = screen.getByTestId('revalidation-notice-listing-1');
    // LOS DOS motivos, no el primero: corregir de uno en uno es el juego de
    // adivinanzas que la decisión D-motivos vino a evitar.
    expect(aviso).toHaveTextContent('Falta "Año", que es obligatorio.');
    expect(aviso).toHaveTextContent('"viejo" ya no es un atributo de esta categoría.');
    // Y la salida: el anuncio no ha desaparecido, se arregla editándolo.
    expect(aviso).toHaveTextContent('Sigue publicado y visible');
  });

  it('marcado: el estado del anuncio SIGUE siendo «Activo»', () => {
    renderCard({ needsRevalidation: true, revalidationReasons: [] });

    // Es la mitad que se olvida: marcar no saca del mercado. Si la insignia
    // dijera otra cosa, la tarjeta estaría mintiendo sobre lo que ve el
    // comprador — que sigue viendo el anuncio con total normalidad.
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByTestId('revalidation-notice-listing-1')).toBeInTheDocument();
  });

  it('marcado sin motivos: avisa igual, sin lista vacía', () => {
    // Puede pasar si el schema cambió otra vez entre el marcado y la lectura.
    // El aviso sigue siendo cierto («algo hay que revisar») y editar lo resuelve.
    renderCard({ needsRevalidation: true, revalidationReasons: [] });
    const aviso = screen.getByTestId('revalidation-notice-listing-1');
    expect(aviso).toHaveTextContent('Este anuncio necesita una actualización');
    expect(aviso.querySelector('ul')).toBeNull();
  });
});
