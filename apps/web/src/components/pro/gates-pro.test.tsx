/**
 * LOS GATES QUE NO EXPLICABAN — el lado de la interfaz.
 *
 * LA REGLA que estos casos fijan, una para los cinco sitios: **a un no-Pro se le CUENTA lo
 * que Pro le daría, en el punto de fricción, con enlace a `/planes`**. Esconder el beneficio
 * hasta que alguien pague lo deja invisible justo para quien hay que convencer.
 *
 * Antes había dos gates bien hechos —vídeo y estadísticas— y cinco sitios mudos; eran los dos
 * únicos enlaces a `/planes` desde un gate en toda la aplicación.
 *
 * Ver docs/auditoria-pro-video.md §4.2.
 */
import { render, screen, cleanup } from '@testing-library/react';
import { ProGate, ProHint } from './ProGate';
import { PackList } from '@/app/(account)/mis-creditos/_components/PackList';
import { BumpPackList } from '@/app/(account)/mis-creditos/_components/BumpPackList';
import { MisAnunciosClient } from '@/components/anuncios/MisAnunciosClient';
import type { CatalogProduct, ProStatus } from '@/lib/api/billing';

jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { slug: 'u', accessToken: 't' } },
    status: 'authenticated',
  }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/mis-creditos',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/lib/api/billing', () => ({
  createPackCheckout: jest.fn(),
  createBumpPackCheckout: jest.fn(),
  getProStatus: jest.fn(() => Promise.resolve({})),
  getWallet: jest.fn(() => Promise.resolve({ balance: 0, bumpBalance: 0 })),
}));

jest.mock('@/lib/api/anuncios', () => ({ getMyListings: jest.fn() }));

/** Un pack de 50 créditos cuyo bonus Pro (ya calculado por el servidor) son 10. */
const PACK_CREDITOS: CatalogProduct[] = [
  {
    id: 'p1',
    name: 'Pack Básico',
    description: null,
    type: 'ONE_TIME',
    prices: [
      {
        priceId: 'pr1',
        amount: 9.99,
        currency: 'EUR',
        creditAmount: 50,
        creditPackId: 'cp1',
        packName: 'Básico',
        proBonusAmount: 10,
      },
    ],
  },
];

const PACK_BUMPS: CatalogProduct[] = [
  {
    id: 'p2',
    name: 'Pack Bumps',
    description: null,
    type: 'ONE_TIME',
    prices: [
      {
        priceId: 'pr2',
        amount: 4.99,
        currency: 'EUR',
        bumpAmount: 20,
        bumpPackId: 'bp1',
        packName: '20 bumps',
        proBonusAmount: 4,
      },
    ],
  },
];

afterEach(cleanup);

describe('El molde compartido', () => {
  it('ProGate: candado, lo que se pierde y el camino a /planes', () => {
    render(<ProGate testId="gate-x">Esto es una ventaja Pro.</ProGate>);
    expect(screen.getByTestId('gate-x')).toHaveTextContent('Esto es una ventaja Pro.');
    expect(screen.getByRole('link', { name: 'Hazte Pro' })).toHaveAttribute('href', '/planes');
  });

  it('ProHint: la misma salida, sin bloquear nada', () => {
    render(<ProHint testId="hint-x">Con Pro te llevarías más.</ProHint>);
    expect(screen.getByTestId('hint-x')).toHaveTextContent('Con Pro te llevarías más.');
    expect(screen.getByRole('link', { name: 'Ver Pro' })).toHaveAttribute('href', '/planes');
  });

  it('REQUISITO DE ORO — los dos llevan SIEMPRE a /planes', () => {
    // Es lo que define un gate que explica frente a uno que sólo impide: la salida. Si
    // alguien cambiara el destino, aquí se ve.
    const { unmount } = render(<ProGate testId="g">x</ProGate>);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/planes');
    unmount();
    render(<ProHint testId="h">x</ProHint>);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/planes');
  });
});

describe('E-5 — los packs de CRÉDITOS, que no previsualizaban nada para nadie', () => {
  it('un NO-Pro ve lo que se pierde, con la cifra y el enlace', () => {
    render(<PackList packs={PACK_CREDITOS} isPro={false} proExtraCreditsPercent={20} />);

    const pista = screen.getByTestId('pack-bonus-hint');
    expect(pista).toHaveTextContent('Con Pro te llevarías 10 créditos más');
    expect(pista).toHaveTextContent('20%');
    expect(screen.getByRole('link', { name: 'Ver Pro' })).toHaveAttribute('href', '/planes');
  });

  it('un PRO ve su regalo ANTES de pagar — antes lo descubría después de cobrar', () => {
    render(<PackList packs={PACK_CREDITOS} isPro proExtraCreditsPercent={20} />);

    expect(screen.getByTestId('pack-bonus-pro')).toHaveTextContent('+ 10 de regalo por ser Pro');
    // A quien ya es Pro no se le vende Pro.
    expect(screen.queryByTestId('pack-bonus-hint')).not.toBeInTheDocument();
  });

  it('el número sale del SERVIDOR: sin él no se inventa ninguno', () => {
    // La lista ya no calcula el bonus. Si el catálogo no lo trae —backend anterior—, no se
    // promete nada en vez de estimarlo por su cuenta y arriesgarse a fallar.
    const sinBonus: CatalogProduct[] = [
      { ...PACK_CREDITOS[0], prices: [{ ...PACK_CREDITOS[0].prices[0], proBonusAmount: undefined }] },
    ];
    render(<PackList packs={sinBonus} isPro={false} proExtraCreditsPercent={20} />);

    expect(screen.queryByTestId('pack-bonus-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pack-bonus-pro')).not.toBeInTheDocument();
  });
});

describe('E-4 — los packs de BUMPS, que sólo lo contaban a medias', () => {
  it('un NO-Pro ve lo que se pierde — antes esta rama era literalmente `: 0`', () => {
    render(<BumpPackList packs={PACK_BUMPS} isPro={false} proExtraBumpsPercent={20} />);

    expect(screen.getByTestId('pack-bonus-hint')).toHaveTextContent(
      'Con Pro te llevarías 4 bumps más (+20%).',
    );
  });

  it('un PRO sigue viendo su regalo, igual que antes', () => {
    render(<BumpPackList packs={PACK_BUMPS} isPro proExtraBumpsPercent={20} />);
    expect(screen.getByTestId('pack-bonus-pro')).toHaveTextContent('+ 4 de regalo por ser Pro');
  });

  it('SIMETRÍA — créditos y bumps se comportan igual', () => {
    // La asimetría era del código, no del producto: bumps a medias y créditos nada. Este
    // caso es el que impide que vuelvan a separarse.
    const { unmount } = render(
      <PackList packs={PACK_CREDITOS} isPro={false} proExtraCreditsPercent={20} />,
    );
    expect(screen.getByTestId('pack-bonus-hint')).toBeInTheDocument();
    unmount();

    render(<BumpPackList packs={PACK_BUMPS} isPro={false} proExtraBumpsPercent={20} />);
    expect(screen.getByTestId('pack-bonus-hint')).toBeInTheDocument();
  });
});

describe('E-6 — las cuotas mensuales, que sólo se contaban a quien ya las tenía', () => {
  const base = {
    initialListings: [],
    token: 't',
    bumpPricing: { bumpCreditCost: 5, bumpBalance: 0, bumpQuota: { limit: 0, used: 0, remaining: 0 } },
  } as unknown as Parameters<typeof MisAnunciosClient>[0];

  const estado = (over: Partial<ProStatus>): ProStatus => ({
    isPro: false,
    limit: 0,
    used: 0,
    remaining: 0,
    bumpQuota: { limit: 0, used: 0, remaining: 0 },
    ...over,
  });

  it('un NO-Pro ve lo que incluiría una suscripción, con las cifras configuradas', () => {
    render(
      <MisAnunciosClient
        {...base}
        initialProStatus={estado({})}
        cuotaDestacados={4}
        cuotaBumps={3}
      />,
    );

    const pista = screen.getByTestId('quota-upsell');
    expect(pista).toHaveTextContent('4 destacados');
    expect(pista).toHaveTextContent('3 bumps');
    expect(screen.getByRole('link', { name: 'Ver Pro' })).toHaveAttribute('href', '/planes');
  });

  it('HONESTO CON D-1 — dice «suscribiéndote», no «con Pro»', () => {
    // La cuota cuelga del ciclo de facturación de una suscripción, así que un Pro CONCEDIDO
    // por el equipo NO la tiene. «Con Pro» le prometería a ese futuro usuario algo que no
    // va a recibir; «suscribiéndote» es cierto para los dos.
    render(<MisAnunciosClient {...base} initialProStatus={estado({})} cuotaDestacados={4} cuotaBumps={3} />);

    expect(screen.getByTestId('quota-upsell')).toHaveTextContent(/suscribiéndote a pro/i);
  });

  it('un PRO DE PAGO sigue viendo su recuento real, no la pista', () => {
    render(
      <MisAnunciosClient
        {...base}
        initialProStatus={estado({
          isPro: true,
          quotaSource: 'SUBSCRIPTION',
          limit: 4,
          remaining: 2,
          bumpQuota: { limit: 4, used: 0, remaining: 4 },
        })}
        cuotaDestacados={4}
        cuotaBumps={4}
      />,
    );

    expect(screen.getByTestId('quota-reminder')).toHaveTextContent('Te quedan 2 destacados');
    expect(screen.queryByTestId('quota-upsell')).not.toBeInTheDocument();
  });

  it('y un PRO CONCEDIDO no ve NINGUNO de los dos: no tiene cuota que contar', () => {
    // El caso que el `isPro` de antes pintaba mal: le decía «Has usado tus destacados
    // gratis de este mes» sobre unos destacados que nunca tuvo (D-1).
    render(
      <MisAnunciosClient
        {...base}
        initialProStatus={estado({ isPro: true, quotaSource: 'NONE' })}
        cuotaDestacados={4}
        cuotaBumps={4}
      />,
    );

    expect(screen.queryByTestId('quota-reminder')).not.toBeInTheDocument();
    // Tampoco la pista de venta: ya es Pro.
    expect(screen.queryByTestId('quota-upsell')).not.toBeInTheDocument();
  });
});
