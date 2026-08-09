/**
 * UXV.6 (M12) — la cuota Pro se ve también cuando está agotada, y son DOS.
 *
 * Se prueba aquí y no en Playwright porque `/mis-anuncios` es un Server Component: el
 * `proStatus` con el que se pinta el aviso lo resuelve el servidor, así que desde el
 * navegador no se puede fabricar el caso «cuota a cero» sin consumirla de verdad. El
 * componente sí acepta el estado por props.
 *
 * EL DEFECTO: la condición era `isPro && remaining > 0`. Al gastar el último destacado el
 * aviso desaparecía ENTERO, y desde fuera «no soy Pro» y «ya la gasté» se veían idénticos
 * — ninguno de los dos decía nada. Y la cuota de BUMPS no aparecía en ninguna parte salvo
 * incrustada en el texto de un botón.
 */
import { render, screen, cleanup } from '@testing-library/react';
import { MisAnunciosClient } from './MisAnunciosClient';
import type { ProStatus } from '@/lib/api/billing';
import type { BumpPricing } from '@/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
  usePathname: () => '/mis-anuncios',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
  signOut: jest.fn(),
}));

jest.mock('@/lib/api/anuncios', () => ({ getMyListings: jest.fn() }));
jest.mock('@/lib/api/billing', () => ({
  getProStatus: jest.fn(),
  getWallet: jest.fn(),
  bumpListing: jest.fn(),
}));

const PRICING: BumpPricing = {
  bumpCreditCost: 5,
  bumpBalance: 0,
  bumpQuota: { limit: 0, used: 0, remaining: 0 },
};

function renderCon(proStatus: ProStatus) {
  render(
    <MisAnunciosClient
      initialListings={[]}
      initialProStatus={proStatus}
      token="t"
      bumpPricing={PRICING}
    />,
  );
}

const pro = (destacados: number, bumps: number): ProStatus => ({
  isPro: true,
  limit: 4,
  used: 4 - destacados,
  remaining: destacados,
  bumpQuota: { limit: 5, used: 5 - bumps, remaining: bumps },
});

afterEach(cleanup);

describe('UXV.6 (M12) — recordatorio de cuota Pro', () => {
  it('con cuota disponible dice cuánta queda, de las DOS monedas', () => {
    renderCon(pro(3, 2));

    const aviso = screen.getByTestId('quota-reminder');
    expect(aviso).toHaveTextContent(/te quedan 3 destacados gratis/i);
    // La de bumps es la que no se veía en ninguna parte.
    expect(aviso).toHaveTextContent(/y 2 bumps gratis/i);
  });

  it('AGOTADA sigue viéndose: distingue «ya la gasté» de «no soy Pro»', () => {
    renderCon(pro(0, 0));

    const aviso = screen.getByTestId('quota-reminder');
    expect(aviso).toHaveTextContent(/has usado tus destacados gratis de este mes/i);
    expect(aviso).toHaveTextContent(/ningún bump gratis/i);
  });

  it('una agotada y la otra no: cada una cuenta lo suyo', () => {
    renderCon(pro(0, 4));

    const aviso = screen.getByTestId('quota-reminder');
    expect(aviso).toHaveTextContent(/has usado tus destacados gratis/i);
    expect(aviso).toHaveTextContent(/y 4 bumps gratis/i);
  });

  it('a un NO-Pro no se le enseña nada: no tiene cuota que agotar', () => {
    renderCon({
      isPro: false,
      limit: 0,
      used: 0,
      remaining: 0,
      bumpQuota: { limit: 0, used: 0, remaining: 0 },
    });

    expect(screen.queryByTestId('quota-reminder')).not.toBeInTheDocument();
  });

  it('singular y plural, que se leen todo el rato', () => {
    renderCon(pro(1, 1));

    const aviso = screen.getByTestId('quota-reminder');
    expect(aviso).toHaveTextContent(/te quedan 1 destacado gratis/i);
    expect(aviso).toHaveTextContent(/y 1 bump gratis/i);
  });
});
