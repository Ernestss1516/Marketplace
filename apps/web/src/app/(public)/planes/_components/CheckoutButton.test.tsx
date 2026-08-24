/**
 * H-2 — EL BOTÓN DE `/planes` MIRABA EL EJE EQUIVOCADO.
 *
 * Bloqueaba con `isPro` («¿tiene las ventajas Pro?») cuando la pregunta que decide si
 * alguien puede COMPRAR el plan es otra: «¿ya paga una suscripción?». Para un cliente de
 * pago las dos coinciden, y por eso el defecto no se veía. Para un Pro CONCEDIDO por el
 * equipo —Pro sin suscripción— no coinciden: veía «Ya eres Pro» deshabilitado mientras el
 * servidor **sí** le habría dejado suscribirse.
 *
 * Perdía justo el caso más deseable: el que tuvo Pro de regalo y quiere pagarlo.
 *
 * Ver docs/auditoria-pro-video.md §1.5.
 */
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { getProStatus, type ProStatus } from '@/lib/api/billing';
import { CheckoutButton } from './CheckoutButton';

jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { slug: 'usuario', accessToken: 'token-de-prueba' } },
    status: 'authenticated',
  }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/planes',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/lib/api/billing', () => ({
  getProStatus: jest.fn(),
  createCheckout: jest.fn(),
}));

const mockProStatus = getProStatus as jest.MockedFunction<typeof getProStatus>;

/** Un `ProStatus` con los dos ejes puestos a mano — que es de lo que va este arreglo. */
function estado(isPro: boolean, hasActiveSubscription: boolean): ProStatus {
  return {
    isPro,
    hasActiveSubscription,
    limit: 0,
    used: 0,
    remaining: 0,
    bumpQuota: { limit: 0, used: 0, remaining: 0 },
  };
}

beforeEach(() => jest.clearAllMocks());
afterEach(cleanup);

/** El botón habilitado con su etiqueta de compra. */
async function esperarBotonDeCompra() {
  const boton = await screen.findByRole('button', { name: 'Hazte Pro' });
  await waitFor(() => expect(boton).toBeEnabled());
  return boton;
}

describe('CheckoutButton — quién puede comprar el plan', () => {
  it('PRO CONCEDIDO (Pro sin suscripción): PUEDE pagar — el hueco H-2', () => {
    // El caso entero. `isPro` en true y `hasActiveSubscription` en false: antes esto pintaba
    // «Ya eres Pro» deshabilitado y le cerraba la puerta a convertirse en cliente de pago.
    mockProStatus.mockResolvedValue(estado(true, false));
    render(<CheckoutButton priceId="price-pro" />);

    return esperarBotonDeCompra().then(() => {
      expect(screen.queryByTestId('ya-eres-pro')).not.toBeInTheDocument();
    });
  });

  it('PRO DE PAGO: sigue viendo «Ya eres Pro» deshabilitado — no paga dos veces', async () => {
    mockProStatus.mockResolvedValue(estado(true, true));
    render(<CheckoutButton priceId="price-pro" />);

    expect(await screen.findByTestId('ya-eres-pro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ya eres Pro/ })).toBeDisabled();
  });

  it('NO-Pro: «Hazte Pro» habilitado, como siempre', async () => {
    mockProStatus.mockResolvedValue(estado(false, false));
    render(<CheckoutButton priceId="price-pro" />);

    await esperarBotonDeCompra();
  });

  it('EL EJE, aislado: lo que decide es la suscripción, no `isPro`', async () => {
    // La prueba que caza una vuelta atrás. Los dos casos tienen `isPro: true` y sólo se
    // diferencian en el eje nuevo; si alguien volviera a mirar `isPro`, los dos pintarían lo
    // mismo y este par dejaría de distinguirlos.
    mockProStatus.mockResolvedValue(estado(true, false));
    const { unmount } = render(<CheckoutButton priceId="price-pro" />);
    await esperarBotonDeCompra();
    unmount();

    mockProStatus.mockResolvedValue(estado(true, true));
    render(<CheckoutButton priceId="price-pro" />);
    expect(await screen.findByTestId('ya-eres-pro')).toBeInTheDocument();
  });

  it('ANTE LA DUDA no se bloquea: si el estado no llega, decide el servidor', async () => {
    // Política que el botón ya tenía escrita y que el arreglo conserva: dejar sin
    // suscribirse a alguien que sí puede es peor que enseñarle el botón, porque el guard del
    // backend está detrás para impedir el cobro doble.
    mockProStatus.mockRejectedValue(new Error('sin red'));
    render(<CheckoutButton priceId="price-pro" />);

    await esperarBotonDeCompra();
  });

  it('y un backend anterior al campo tampoco bloquea', async () => {
    // `hasActiveSubscription` ausente → `?? false` → habilitado. Mismo criterio que el
    // `catch`: la ausencia de dato no es una razón para impedir una compra.
    const sinCampo = estado(true, false) as ProStatus;
    delete sinCampo.hasActiveSubscription;
    mockProStatus.mockResolvedValue(sinCampo);
    render(<CheckoutButton priceId="price-pro" />);

    await esperarBotonDeCompra();
  });
});
