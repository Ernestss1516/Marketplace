/**
 * PUERTA regla #2 — publicar un borrador que se queda en borrador.
 *
 * Lo que se fija aquí es el REPARTO DE CANALES, que es donde esta regla se puede
 * estropear sin que nadie lo note:
 *
 *  · NO es el canal de error — la petición devolvió 200 y no se ha perdido nada.
 *  · NO es el canal de éxito — un toast «Anuncio publicado» sobre un anuncio que
 *    NO se ha publicado es peor que no avisar: le dice al vendedor que ya está.
 *  · Es un aviso inline, junto al botón que lo provocó, y con la salida.
 */

import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import { toast } from 'sonner';
import { publishListing } from '@/lib/api/anuncios';
import { MyListingCard } from './MyListingCard';
import type { BumpPricing, ListingSummary } from '@/types';

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

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
    Promise.resolve({ isPro: false, limit: 0, used: 0, remaining: 0, bumpQuota: { limit: 0, used: 0, remaining: 0 } }),
  ),
}));

jest.mock('@/lib/api/anuncios', () => ({
  publishListing: jest.fn(),
  reserveListing: jest.fn(),
  deleteListing: jest.fn(),
  renewListing: jest.fn(),
  pauseListing: jest.fn(),
  reactivateListing: jest.fn(),
  archiveListing: jest.fn(),
}));

const mockPublish = publishListing as jest.MockedFunction<typeof publishListing>;

const PRICING: BumpPricing = {
  bumpCreditCost: 5,
  bumpBalance: 0,
  bumpQuota: { limit: 0, used: 0, remaining: 0 },
};

const AVISO =
  'Verifica tu correo para publicar. El anuncio se ha guardado como borrador y podrás publicarlo en cuanto lo verifiques.';

function renderBorrador() {
  const listing = {
    id: 'listing-1',
    title: 'Borrador de prueba',
    slug: 'borrador-de-prueba',
    price: 100,
    currency: 'EUR',
    priceType: 'FIXED',
    status: 'DRAFT',
    type: 'PRODUCT',
  } as ListingSummary;

  return render(
    <MyListingCard listing={listing} token="token-de-prueba" onAction={jest.fn()} bumpPricing={PRICING} />,
  );
}

beforeEach(() => jest.clearAllMocks());
afterEach(cleanup);

describe('Publicar un borrador que se queda en borrador', () => {
  it('degradado: avisa inline, con la salida, y NO canta éxito', async () => {
    mockPublish.mockResolvedValue({
      id: 'listing-1',
      slug: 'borrador-de-prueba',
      status: 'DRAFT',
      publishedAt: '',
      publishBlocked: { code: 'EMAIL_NOT_VERIFIED', message: AVISO },
    });

    renderBorrador();
    fireEvent.click(screen.getByRole('button', { name: /publicar/i }));

    const aviso = await screen.findByTestId('publish-blocked-listing-1');
    expect(aviso).toHaveTextContent('Verifica tu correo para publicar');
    // LA SALIDA, no sólo el problema.
    expect(screen.getByRole('link', { name: 'Verificar ahora' })).toHaveAttribute(
      'href',
      '/verificar-email',
    );
    // Y el canal de éxito, callado: el anuncio NO se ha publicado.
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('publicado de verdad: toast de éxito y ningún aviso', async () => {
    // El control positivo. Sin él, un aviso que saliera SIEMPRE pasaría el test
    // de arriba pareciendo correcto.
    mockPublish.mockResolvedValue({
      id: 'listing-1',
      slug: 'borrador-de-prueba',
      status: 'ACTIVE',
      publishedAt: '2026-01-01',
    });

    renderBorrador();
    fireEvent.click(screen.getByRole('button', { name: /publicar/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Anuncio publicado.'));
    expect(screen.queryByTestId('publish-blocked-listing-1')).toBeNull();
  });
});
