/**
 * ROTACIÓN — R4: LA CIFRA ES UN EXTRA, NO UN REQUISITO.
 *
 * La cuenta de con cuántos competiría el anuncio es información valiosa, pero es información:
 * si el servidor no la da —está caído, tarda, devuelve un 500—, el vendedor tiene que poder
 * comprar igual, y con la promesa de R3 delante, que sigue siendo cierta sin la cifra.
 *
 * Un número orientativo que impidiera vender sería un defecto peor que no tenerlo.
 *
 * LA MUTACIÓN QUE ESTO MATA: quitar el `.catch(() => null)` de la carga, o pintar la cifra sin
 * comprobar que llegó. Cualquiera de las dos convierte un fallo de un dato accesorio en un
 * diálogo roto (o en un «undefined» a la vista de quien va a pagar).
 */

import { render, screen, waitFor } from '@testing-library/react';
import { PromocionarDialog } from './PromocionarDialog';
import type { BumpPricing } from '@/types';

jest.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/mis-anuncios',
}));

const getFeaturedCompetition = jest.fn();

jest.mock('@/lib/api/billing', () => ({
  getCatalog: () => Promise.resolve({ products: [], bumpCreditCost: 5, proExtraBumpsPercent: 20 }),
  getWallet: () => Promise.resolve({ balance: 100 }),
  getProStatus: () => Promise.resolve(null),
  getFeaturedCompetition: (...args: unknown[]) => getFeaturedCompetition(...args),
  featuredByCredits: jest.fn(),
  createFeaturedCheckout: jest.fn(),
  bumpListing: jest.fn(),
}));

const PRICING: BumpPricing = {
  bumpCreditCost: 5,
  bumpBalance: 0,
  bumpQuota: { limit: 0, used: 0, remaining: 0 },
};

function pintarDialogo() {
  return render(
    <PromocionarDialog
      listing={{ id: 'l1' }}
      token="t"
      open
      onOpenChange={() => {}}
      onSuccess={() => {}}
      bumpPricing={PRICING}
      productoInicial="destacado"
    />,
  );
}

describe('R4 — si el conteo falla, el diálogo sigue en pie', () => {
  beforeEach(() => getFeaturedCompetition.mockReset());

  it('SIN la cifra (el conteo revienta), la promesa de R3 sigue ahí y se puede comprar', async () => {
    getFeaturedCompetition.mockRejectedValue(new Error('500 desde el servidor'));

    pintarDialogo();

    // La promesa genérica —la que vale siempre— sigue delante del vendedor.
    await waitFor(() =>
      expect(screen.getByText(/entra en el turno del bloque/i)).toBeInTheDocument(),
    );
    // Y la cifra, que es el extra, simplemente no se pinta. Ni un «undefined», ni un cero.
    expect(screen.queryByTestId('destacado-competencia')).toBeNull();
  });

  it('CON la cifra, se pinta junto a la promesa', async () => {
    getFeaturedCompetition.mockResolvedValue({
      categoria: { name: 'Coches', slug: 'coches' },
      vigentes: 11,
      cuota: {
        candidatos: 12,
        grupos: 3,
        siempre: false,
        minutosDeVitrinaAlDia: 480,
        cicloMinutos: 45,
      },
    });

    pintarDialogo();

    const cifra = await screen.findByTestId('destacado-competencia');
    expect(cifra).toHaveTextContent('11 anuncios destacados en Coches');
    expect(cifra).toHaveTextContent('8 h al día');
    expect(screen.getByText(/entra en el turno del bloque/i)).toBeInTheDocument();
  });

  it('se pide UNA vez al abrir, con el anuncio y el token — no en cada render', async () => {
    getFeaturedCompetition.mockResolvedValue(null);

    pintarDialogo();

    await waitFor(() => expect(getFeaturedCompetition).toHaveBeenCalled());
    expect(getFeaturedCompetition).toHaveBeenCalledTimes(1);
    expect(getFeaturedCompetition).toHaveBeenCalledWith('l1', 't');
  });
});
