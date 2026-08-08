/**
 * UXV.1 (A2) — las DOS superficies de propietario leen el mismo cooldown.
 *
 * El defecto no era solo que la tarjeta se inventara 24 horas: era que había tres
 * cálculos distintos de "¿puedo bumpear ya?" (backend 1 h, `MyListingCard` 24 h,
 * `ListingOwnerActions` ninguno) y ninguno coincidía. El e2e
 * `uxv1-bump-cooldown.e2e-spec.ts` fija el lado del backend (una ventana, servida como
 * `nextBumpAt` en los dos payloads). Aquí se fija el lado del frontend: dadas las MISMAS
 * condiciones, las dos superficies muestran el MISMO estado.
 *
 * Se renderizan los dos componentes REALES, no una función suelta: lo que se afirma es
 * que ninguno de los dos vuelve a derivar la ventana por su cuenta — el fallo original
 * era precisamente una derivación local que nadie comparaba con la otra.
 */

import { render, screen, cleanup } from '@testing-library/react';
import { MyListingCard } from './MyListingCard';
import { ListingOwnerActions } from './ListingOwnerActions';
import { resolveBumpCooldown } from '@/lib/bump-cooldown';
import type { BumpPricing, ListingSummary } from '@/types';

const SELLER_SLUG = 'vendedor-uxv1';

// La ficha decide si eres el dueño comparando `session.user.slug` con el del vendedor.
jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { slug: SELLER_SLUG, accessToken: 'token-de-prueba' } },
    status: 'authenticated',
  }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
  usePathname: () => '/mis-anuncios',
  useSearchParams: () => new URLSearchParams(),
}));

// Ninguna llamada de red debe ocurrir: los tests no pulsan nada, solo miran el estado
// inicial que cada superficie deriva de `nextBumpAt`.
jest.mock('@/lib/api/billing', () => ({
  bumpListing: jest.fn(),
  getCatalog: jest.fn(),
  getWallet: jest.fn(),
  getProStatus: jest.fn(),
  featuredByCredits: jest.fn(),
  createFeaturedCheckout: jest.fn(),
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

const BUMP_PRICING: BumpPricing = {
  bumpCreditCost: 5,
  bumpBalance: 0,
  bumpQuota: { limit: 0, used: 0, remaining: 0 },
};

function listing(nextBumpAt: string | null): ListingSummary {
  return {
    id: 'listing-1',
    title: 'Anuncio de prueba',
    slug: 'anuncio-de-prueba',
    price: 100,
    currency: 'EUR',
    priceType: 'FIXED',
    status: 'ACTIVE',
    type: 'PRODUCT',
    nextBumpAt,
  } as ListingSummary;
}

/** El botón de bump de cada superficie, por su testid de producción. */
function renderBothSurfaces(nextBumpAt: string | null) {
  const { container: cardContainer } = render(
    <MyListingCard
      listing={listing(nextBumpAt)}
      token="token-de-prueba"
      onAction={jest.fn()}
      bumpPricing={BUMP_PRICING}
    />,
  );
  const cardButton = cardContainer.querySelector('[data-testid="btn-bump"]');

  render(
    <ListingOwnerActions
      listingId="listing-1"
      sellerSlug={SELLER_SLUG}
      listingStatus="ACTIVE"
      nextBumpAt={nextBumpAt}
    />,
  );
  const fichaButton = screen.getByTestId('owner-btn-bump');

  return { cardButton: cardButton as HTMLButtonElement, fichaButton };
}

const IN_FUTURE = () => new Date(Date.now() + 30 * 60_000).toISOString(); // dentro de 30 min
const IN_PAST = () => new Date(Date.now() - 30 * 60_000).toISOString(); // hace 30 min

afterEach(cleanup);

describe('UXV.1 (A2) — tarjeta y ficha muestran el mismo estado de cooldown', () => {
  it('cooldown ACTIVO: las dos deshabilitan el botón', () => {
    const { cardButton, fichaButton } = renderBothSurfaces(IN_FUTURE());

    expect(cardButton).toBeDisabled();
    expect(fichaButton).toBeDisabled();
    // Y las dos lo explican en el title, con la fecha que viene de la API.
    expect(cardButton.getAttribute('title')).toMatch(/^Disponible el /);
    expect(fichaButton.getAttribute('title')).toBe(cardButton.getAttribute('title'));
  });

  it('cooldown PASADO: las dos habilitan el botón', () => {
    const { cardButton, fichaButton } = renderBothSurfaces(IN_PAST());

    expect(cardButton).toBeEnabled();
    expect(fichaButton).toBeEnabled();
  });

  it('sin bump previo (nextBumpAt null): las dos habilitan el botón', () => {
    const { cardButton, fichaButton } = renderBothSurfaces(null);

    expect(cardButton).toBeEnabled();
    expect(fichaButton).toBeEnabled();
  });

  /**
   * EL BUG, fijado explícitamente. Con la regla vieja de la tarjeta (`bumpedAt + 24h`),
   * un anuncio bumpeado hace 2 horas seguía deshabilitado 22 horas más aunque el backend
   * lo hubiera aceptado. Aquí la API ya dice que la ventana pasó, y las dos superficies
   * lo respetan.
   */
  it('bumpeado hace 2 h (fuera de la ventana real de 1 h): ninguna de las dos bloquea', () => {
    const bumpedAt = new Date(Date.now() - 2 * 60 * 60_000);
    // Lo que hoy sirve el backend: bumpedAt + 1 h → ya pasó.
    const nextBumpAt = new Date(bumpedAt.getTime() + 60 * 60_000).toISOString();

    const { cardButton, fichaButton } = renderBothSurfaces(nextBumpAt);

    expect(cardButton).toBeEnabled();
    expect(fichaButton).toBeEnabled();
  });
});

describe('UXV.1 (A2) — resolveBumpCooldown no deriva ninguna ventana', () => {
  it('usa el instante de la API tal cual, sin sumarle nada', () => {
    const until = new Date(Date.now() + 60_000);
    const { active, until: resolved } = resolveBumpCooldown(until.toISOString());

    expect(active).toBe(true);
    expect(resolved?.getTime()).toBe(until.getTime());
  });

  it('sin dato (nunca bumpeado) no hay cooldown', () => {
    expect(resolveBumpCooldown(null)).toEqual({ active: false, until: null });
    expect(resolveBumpCooldown(undefined)).toEqual({ active: false, until: null });
  });

  it('una fecha ilegible no bloquea el botón (nunca deja al usuario sin poder bumpear)', () => {
    expect(resolveBumpCooldown('no-es-una-fecha')).toEqual({ active: false, until: null });
  });
});
