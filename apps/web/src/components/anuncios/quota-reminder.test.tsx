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
      // E7 — `null` es el caso que este test quiere: sin ilustración no se pinta nada y
      // el estado vacío queda como estaba, que es lo que estas aserciones miran.
      ilustracionVacio={null}
      initialListings={[]}
      initialProStatus={proStatus}
      token="t"
      bumpPricing={PRICING}
    />,
  );
}

const pro = (destacados: number, bumps: number, periodEnd?: string): ProStatus => ({
  isPro: true,
  limit: 4,
  used: 4 - destacados,
  remaining: destacados,
  bumpQuota: { limit: 5, used: 5 - bumps, remaining: bumps },
  quotaSource: 'SUBSCRIPTION',
  periodEnd,
});

/** Una fecha a `n` días de hoy, en ISO — el formato en que viaja `periodEnd`. */
const enDias = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
};

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

/**
 * LA CADUCIDAD — la parte que el recordatorio de arriba nunca dijo.
 *
 * Contaba CUÁNTA cuota queda y callaba lo único que la hace urgente: que no se acumula. La
 * regla de cuándo avisar vive en `cuota-caducidad.ts` y se prueba entera allí; aquí se fija lo
 * que le toca a la pantalla — que se pinte donde se ve, que diga lo que hay que hacer, y que
 * **no salga** cuando la regla dice que no.
 */
describe('Aviso de caducidad de la cuota — en la pantalla', () => {
  it('con el ciclo a dos días y cuota sin gastar, lo dice y ofrece dónde gastarla', () => {
    renderCon(pro(2, 1, enDias(2)));

    const caducidad = screen.getByTestId('quota-caducidad');
    expect(caducidad).toHaveTextContent(/no se acumulan/i);
    expect(caducidad).toHaveTextContent(/usa 2 destacados y 1 bump antes de perderlos/i);

    // B-4 — ACCIONABLE. Un aviso que dice «date prisa» y no dice dónde es sólo una prisa.
    // Lleva a los ACTIVOS, que son los únicos que se pueden promocionar (`canPromote`).
    expect(screen.getByTestId('quota-caducidad-accion')).toBeInTheDocument();
  });

  it('el último día se dice «hoy», no una fecha que hay que interpretar', () => {
    renderCon(pro(1, 0, enDias(0)));
    expect(screen.getByTestId('quota-caducidad')).toHaveTextContent(/se renuevan hoy/i);
  });

  it('con el ciclo LEJOS no se pinta: el recordatorio sigue, la prisa no', () => {
    renderCon(pro(3, 2, enDias(20)));

    // Las dos cosas a la vez, porque es la diferencia entre «informar» y «meter prisa todo el
    // mes»: el saldo se ve siempre; la urgencia, sólo cuando lo es.
    expect(screen.getByTestId('quota-reminder')).toBeInTheDocument();
    expect(screen.queryByTestId('quota-caducidad')).not.toBeInTheDocument();
  });

  it('con la cuota AGOTADA no se pinta, aunque el ciclo esté a un día', () => {
    renderCon(pro(0, 0, enDias(1)));

    expect(screen.getByTestId('quota-reminder')).toHaveTextContent(/has usado tus destacados/i);
    expect(screen.queryByTestId('quota-caducidad')).not.toBeInTheDocument();
  });

  it('sin `periodEnd` —el Pro MANUAL— no se pinta nada de caducidad', () => {
    renderCon({
      isPro: true,
      quotaSource: 'NONE',
      limit: 0,
      used: 0,
      remaining: 0,
      bumpQuota: { limit: 0, used: 0, remaining: 0 },
    });

    // Y tampoco el recordatorio: no tiene cuota mensual que contar (UXV.6 / D-1).
    expect(screen.queryByTestId('quota-reminder')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quota-caducidad')).not.toBeInTheDocument();
  });
});
