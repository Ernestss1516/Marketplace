/**
 * UXV.1 (A2) + UXV.4 — las DOS superficies de propietario dicen lo mismo.
 *
 * El defecto original (A2) era que había tres cálculos distintos de «¿puedo bumpear ya?».
 * UXV.1 lo cerró con `nextBumpAt`, servido por la API, y este fichero fija que las dos
 * superficies lo respetan igual.
 *
 * UXV.4 amplía la afirmación y cambia la FORMA de comprobarla, porque cambió la interfaz:
 * ya no hay un botón «Bump» que se deshabilita, sino un control «Promocionar» que fusiona
 * subir y destacar (TARJETA-D2). En cooldown ese control NO se apaga —destacar sigue
 * siendo posible—, así que lo que se compara ahora es lo que las dos CUENTAN: el rótulo
 * del control y la línea de estado promocional. Sigue midiendo lo mismo: que ninguna de
 * las dos se invente su propia versión de la ventana.
 */

import { render, screen, cleanup, within } from '@testing-library/react';
import { MyListingCard } from './MyListingCard';
import { ListingOwnerActions } from './ListingOwnerActions';
import { resolveBumpCooldown } from '@/lib/bump-cooldown';
import { resolveBumpOffer, promocionarLabel } from './owner/promocion';
import type { BumpPricing, ListingSummary } from '@/types';

const SELLER_SLUG = 'vendedor-uxv1';

jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { slug: SELLER_SLUG, accessToken: 'token-de-prueba' } },
    status: 'authenticated',
  }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
  usePathname: () => '/anuncio/anuncio-de-prueba',
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * La ficha pide precios por su cuenta (`useBumpPricing`), porque es SSR pública y no puede
 * recibirlos del servidor como sí hace /mis-anuncios. Se resuelven con los MISMOS valores
 * que se le pasan a la tarjeta: si las dos partieran de datos distintos, la comparación no
 * probaría nada.
 */
const PRICING_LIBRE: BumpPricing = {
  bumpCreditCost: 5,
  bumpBalance: 0,
  bumpQuota: { limit: 0, used: 0, remaining: 0 },
};

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

/** Renderiza la tarjeta y devuelve su control primario y su zona de estado. */
function renderTarjeta(nextBumpAt: string | null, pricing: BumpPricing = PRICING_LIBRE) {
  const { container } = render(
    <MyListingCard
      listing={listing(nextBumpAt)}
      token="token-de-prueba"
      onAction={jest.fn()}
      bumpPricing={pricing}
    />,
  );
  return {
    primario: container.querySelector('[data-testid="btn-promocionar"]') as HTMLButtonElement,
    estado: container.querySelector('[data-testid="estado-promocion"]'),
  };
}

/** Renderiza la ficha. Espera a que resuelva `useBumpPricing`. */
async function renderFicha(nextBumpAt: string | null) {
  render(
    <ListingOwnerActions
      listingId="listing-1"
      sellerSlug={SELLER_SLUG}
      listingStatus="ACTIVE"
      nextBumpAt={nextBumpAt}
    />,
  );
  const primario = await screen.findByTestId('btn-promocionar');
  return {
    primario: primario as HTMLButtonElement,
    estado: screen.queryByTestId('estado-promocion'),
  };
}

const EN_FUTURO = () => new Date(Date.now() + 30 * 60_000).toISOString();
const EN_PASADO = () => new Date(Date.now() - 30 * 60_000).toISOString();

afterEach(cleanup);

describe('UXV.1/UXV.4 — tarjeta y ficha cuentan el mismo cooldown', () => {
  it('cooldown ACTIVO: las dos lo anuncian, con la misma fecha', async () => {
    const nextBumpAt = EN_FUTURO();

    const tarjeta = renderTarjeta(nextBumpAt);
    expect(tarjeta.estado).not.toBeNull();
    const textoTarjeta = within(tarjeta.estado! as HTMLElement).getByText(/podrás volver a subirlo/i)
      .textContent;

    cleanup();

    const ficha = await renderFicha(nextBumpAt);
    expect(ficha.estado).not.toBeNull();
    const textoFicha = within(ficha.estado! as HTMLElement).getByText(/podrás volver a subirlo/i).textContent;

    expect(textoFicha).toBe(textoTarjeta);
  });

  it('cooldown ACTIVO: el control primario NO se apaga — destacar sigue siendo posible', async () => {
    const nextBumpAt = EN_FUTURO();

    // Es el cambio de UXV.4 respecto a UXV.1: antes el botón «Bump» se deshabilitaba;
    // ahora «Promocionar» sigue vivo porque el destacado no depende del cooldown.
    const tarjeta = renderTarjeta(nextBumpAt);
    expect(tarjeta.primario).toBeEnabled();
    expect(tarjeta.primario).toHaveTextContent(/promocionar/i);
    cleanup();

    const ficha = await renderFicha(nextBumpAt);
    expect(ficha.primario).toBeEnabled();
    expect(ficha.primario).toHaveTextContent(/promocionar/i);
  });

  it('cooldown PASADO: ninguna de las dos anuncia espera', async () => {
    const nextBumpAt = EN_PASADO();

    const tarjeta = renderTarjeta(nextBumpAt);
    expect(tarjeta.estado).toBeNull();
    cleanup();

    const ficha = await renderFicha(nextBumpAt);
    expect(ficha.estado).toBeNull();
  });

  it('sin bump previo: las dos ofrecen promocionar sin espera', async () => {
    const tarjeta = renderTarjeta(null);
    expect(tarjeta.primario).toBeEnabled();
    expect(tarjeta.estado).toBeNull();
    cleanup();

    const ficha = await renderFicha(null);
    expect(ficha.primario).toBeEnabled();
    expect(ficha.estado).toBeNull();
  });

  /**
   * EL BUG ORIGINAL, fijado. Con la regla vieja de la tarjeta (`bumpedAt + 24h`), un
   * anuncio bumpeado hace 2 horas seguía bloqueado 22 horas más aunque el backend lo
   * aceptara. Aquí la API ya dice que la ventana pasó y ninguna de las dos anuncia espera.
   */
  it('bumpeado hace 2 h (fuera de la ventana real de 1 h): ninguna de las dos hace esperar', async () => {
    const bumpedAt = new Date(Date.now() - 2 * 60 * 60_000);
    const nextBumpAt = new Date(bumpedAt.getTime() + 60 * 60_000).toISOString();

    const tarjeta = renderTarjeta(nextBumpAt);
    expect(tarjeta.estado).toBeNull();
    cleanup();

    const ficha = await renderFicha(nextBumpAt);
    expect(ficha.estado).toBeNull();
  });
});

describe('UXV.4 — el rótulo del control primario sale de la misma función', () => {
  it('con bump gratis disponible es «Subir gratis» (un clic); si no, «Promocionar»', () => {
    const conCuota: BumpPricing = {
      ...PRICING_LIBRE,
      bumpQuota: { limit: 3, used: 0, remaining: 3 },
    };
    expect(promocionarLabel(resolveBumpOffer(conCuota, null))).toBe('Subir gratis');
    expect(promocionarLabel(resolveBumpOffer(PRICING_LIBRE, null))).toBe('Promocionar');
    // En cooldown no hay «gratis a un clic» que ofrecer, aunque haya cuota.
    expect(promocionarLabel(resolveBumpOffer(conCuota, EN_FUTURO()))).toBe('Promocionar');
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
