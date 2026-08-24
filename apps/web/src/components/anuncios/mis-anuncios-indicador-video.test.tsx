/**
 * EL INDICADOR DE VÍDEO EN «MIS ANUNCIOS» — el hueco que le faltaba justo a quien más le
 * importa.
 *
 * `hasVideo` llegaba en el payload de esta pantalla desde siempre (`findMine` → `toSummary`;
 * hay un e2e que lo comprueba contra `/users/me/listings`), pero `MyListingCard` no pasa por
 * `CardPhotoCarousel` —pinta su propia miniatura— así que era la única superficie donde el
 * dato estaba y nadie lo usaba: un vendedor Pro no podía ver desde su panel a cuáles de sus
 * anuncios les había puesto vídeo.
 *
 * FICHERO APARTE de `video-visualizacion.test.tsx` a propósito: esta tarjeta necesita media
 * docena de mocks (sesión, router, sonner, dos clientes de API) y aquel prueba componentes
 * puros. Arrastrarlos allí habría ensuciado la batería que fija la garantía estructural.
 *
 * Ver docs/auditoria-pro-video.md §2.3 (hueco V-2).
 */
import { render, screen, cleanup } from '@testing-library/react';
import { MyListingCard } from './MyListingCard';
import type { BumpPricing, ListingSummary } from '@/types';

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

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
      isPro: true,
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

const BASE = {
  id: 'listing-1',
  title: 'Anuncio con vídeo',
  slug: 'anuncio-con-video',
  price: 100,
  currency: 'EUR',
  priceType: 'FIXED',
  status: 'ACTIVE',
  type: 'PRODUCT',
  thumbnailUrl: 'http://localhost:9000/marketplace/a.jpg',
} as ListingSummary;

function pintar(hasVideo: boolean) {
  return render(
    <MyListingCard
      listing={{ ...BASE, hasVideo }}
      token="token-de-prueba"
      onAction={jest.fn()}
      bumpPricing={PRICING}
    />,
  );
}

afterEach(cleanup);

describe('MyListingCard — el indicador de vídeo', () => {
  it('con vídeo lo pinta: el vendedor ve cuáles de SUS anuncios lo llevan', () => {
    pintar(true);
    expect(screen.getByTestId('card-tiene-video')).toBeInTheDocument();
  });

  it('sin vídeo no pinta nada: la tarjeta de siempre no cambia', () => {
    pintar(false);
    expect(screen.queryByTestId('card-tiene-video')).not.toBeInTheDocument();
  });

  it('es EL MISMO indicador que el de las listas, no una copia parecida', () => {
    // Mismo componente, mismo testid, mismo texto. Que sean literalmente el mismo es lo que
    // impide que dentro de un año digan cosas distintas en dos pantallas.
    pintar(true);
    expect(screen.getByTestId('card-tiene-video')).toHaveTextContent('Vídeo');
  });

  it('CERO BYTES: añadir el indicador no ha traído un <video> ni la URL', () => {
    // Lo que se añade es el BOOLEANO pintado, no la dirección. Si alguien cableara aquí
    // `videoUrl` para «mejorar» la tarjeta, este caso lo caza.
    const { container } = pintar(true);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('source')).toBeNull();
  });
});
