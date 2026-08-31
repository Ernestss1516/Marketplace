/**
 * LA CAMPAÑA, VISIBLE ANTES DE COMPRAR — el lado de la interfaz.
 *
 * EL DEFECTO QUE ESTOS CASOS FIJAN: el bonus de campaña se aplicaba en el checkout y se
 * acreditaba en el monedero, pero la lista de packs no lo enseñaba. El usuario compraba a
 * ciegas y descubría el regalo DESPUÉS, en el historial — la promoción era invisible justo
 * en el instante en el que tenía que convencer.
 *
 * Es el mismo defecto que E-5 cerró para el bonus Pro, y por eso la solución es la misma
 * pieza: el número lo resuelve el servidor con la función que congela el checkout, y aquí
 * sólo se pinta. La diferencia entre los dos bonus es a QUIÉN le tocan — el de Pro sólo a
 * un Pro, el de campaña a cualquiera— y que se SUMAN cuando coinciden.
 *
 * Se prueba aquí y no en Playwright por la razón de siempre en esta pantalla: `/mis-creditos`
 * es un Server Component y su primera carga la sirve el servidor, así que `page.route` no
 * puede fabricar un catálogo con campaña viva (la cabecera de `e2e/mis-creditos.spec.ts` ya
 * documenta esa limitación). El componente recibe todo por props: aquí sí se controla.
 *
 * Ver docs/auditoria-mis-creditos.md §6 (ráfaga A, paso 3) y §7 (barreras 1, 3, 4, 5 y 7).
 */
import { render, screen, cleanup } from '@testing-library/react';
import type { ActiveBonusCampaign, CatalogProduct } from '@/lib/api/billing';
import { PackList } from './PackList';
import { BumpPackList } from './BumpPackList';
import { CampaignNotice } from './CampaignNotice';

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { slug: 'u', accessToken: 't' } }, status: 'authenticated' }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/mis-creditos',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/lib/api/billing', () => ({
  createPackCheckout: jest.fn(),
  createBumpPackCheckout: jest.fn(),
}));

/** Pack de 100 créditos: bonus Pro 20 (20 %), bonus de campaña 20 (20 %). Los dos del servidor. */
const packCreditos = (over: Record<string, unknown> = {}): CatalogProduct[] => [
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
        creditAmount: 100,
        creditPackId: 'cp1',
        packName: 'Pack 100',
        proBonusAmount: 20,
        ...over,
      },
    ],
  },
];

/** Pack de 20 bumps: bonus Pro 4, bonus de campaña 10 (una campaña BUMP_BONUS al 50 %). */
const packBumps = (over: Record<string, unknown> = {}): CatalogProduct[] => [
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
        ...over,
      },
    ],
  },
];

/**
 * MEDIODÍA UTC A PROPÓSITO, no medianoche: el aviso formatea la fecha en hora local, así que
 * un `23:59:59Z` sale como «16 de septiembre» en la España peninsular y como «15» en un CI
 * que corra en UTC. La hora no es lo que se está probando — que el plazo se diga, sí—, y un
 * caso que pasa o falla según el huso de la máquina no prueba nada.
 */
const CAMPANA: ActiveBonusCampaign = {
  name: 'Vuelta al cole',
  endsAt: '2026-09-15T12:00:00.000Z',
};

afterEach(cleanup);

describe('BARRERA 1 — la campaña se ve ANTES de comprar (créditos)', () => {
  it('un NO-Pro ve el regalo de la campaña, con su nombre y el total que recibirá', () => {
    render(
      <PackList
        packs={packCreditos({ campaignBonusAmount: 20 })}
        isPro={false}
        proExtraCreditsPercent={20}
        campaign={CAMPANA}
      />,
    );

    expect(screen.getByTestId('pack-bonus-campana')).toHaveTextContent(
      '+ 20 por la campaña «Vuelta al cole»',
    );
    // 100 de base + 20 de campaña. El Pro NO entra: este usuario no lo es.
    expect(screen.getByTestId('pack-total')).toHaveTextContent('Recibes 120 créditos');
  });

  it('y sigue viendo lo que se pierde por no ser Pro — los dos bonus son independientes', () => {
    render(
      <PackList
        packs={packCreditos({ campaignBonusAmount: 20 })}
        isPro={false}
        proExtraCreditsPercent={20}
        campaign={CAMPANA}
      />,
    );

    // La campaña no sustituye al gate que convierte: un no-Pro se pierde ESE bonus igual
    // con promoción que sin ella, porque se suman en vez de competir.
    expect(screen.getByTestId('pack-bonus-hint')).toHaveTextContent(
      'Con Pro te llevarías 20 créditos más',
    );
  });
});

describe('BARRERA 3 — Pro y campaña se SUMAN, no se sustituyen', () => {
  it('un PRO comprando en campaña ve los DOS regalos y el total correcto', () => {
    render(
      <PackList
        packs={packCreditos({ campaignBonusAmount: 20 })}
        isPro
        proExtraCreditsPercent={20}
        campaign={CAMPANA}
      />,
    );

    expect(screen.getByTestId('pack-bonus-pro')).toHaveTextContent('+ 20 de regalo por ser Pro');
    expect(screen.getByTestId('pack-bonus-campana')).toHaveTextContent('+ 20 por la campaña');
    // 100 + 20 + 20 = 140. Cada bonus contra la base, nunca uno sobre el otro (140, no 144):
    // es lo mismo que hace el processor al acreditar.
    expect(screen.getByTestId('pack-total')).toHaveTextContent('Recibes 140 créditos');
    // A quien ya es Pro no se le vende Pro, campaña o no.
    expect(screen.queryByTestId('pack-bonus-hint')).not.toBeInTheDocument();
  });
});

describe('BARRERA 4 — el número viene del backend; la lista no calcula ninguno', () => {
  it('sin `campaignBonusAmount` no se promete nada, aunque haya campaña', () => {
    // El contexto de la campaña puede llegar sin el importe (backend a medio desplegar).
    // Antes que estimarlo aplicando el porcentaje por su cuenta —y arriesgarse a mostrar un
    // número distinto del que el checkout congela—, la lista calla. Mismo criterio que E-5
    // fijó para `proBonusAmount`.
    render(
      <PackList packs={packCreditos()} isPro proExtraCreditsPercent={20} campaign={CAMPANA} />,
    );

    expect(screen.queryByTestId('pack-bonus-campana')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pack-total')).not.toBeInTheDocument();
  });

  it('el importe manda sobre cualquier fórmula: un 7 se pinta como 7', () => {
    // Si el servidor dice 7 (un FIXED, un redondeo, un tope), se enseña 7. No hay ninguna
    // multiplicación en el cliente que pueda contradecirlo.
    render(
      <PackList
        packs={packCreditos({ campaignBonusAmount: 7 })}
        isPro={false}
        proExtraCreditsPercent={20}
        campaign={CAMPANA}
      />,
    );

    expect(screen.getByTestId('pack-bonus-campana')).toHaveTextContent('+ 7 por la campaña');
    expect(screen.getByTestId('pack-total')).toHaveTextContent('Recibes 107 créditos');
  });
});

describe('BARRERA 5 — degradación limpia: sin campaña, la lista pinta como antes', () => {
  it('un PRO sin campaña ve exactamente lo de siempre, sin total ni línea de campaña', () => {
    render(<PackList packs={packCreditos()} isPro proExtraCreditsPercent={20} />);

    expect(screen.getByTestId('pack-bonus-pro')).toHaveTextContent('+ 20 de regalo por ser Pro');
    expect(screen.queryByTestId('pack-bonus-campana')).not.toBeInTheDocument();
    // El total sólo aparece cuando hay dos sumandos: con uno, la línea de abajo ya lo dice.
    expect(screen.queryByTestId('pack-total')).not.toBeInTheDocument();
  });

  it('un NO-Pro sin campaña, igual: sólo la pista de Pro', () => {
    render(<PackList packs={packCreditos()} isPro={false} proExtraCreditsPercent={20} />);

    expect(screen.getByTestId('pack-bonus-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('pack-bonus-campana')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pack-total')).not.toBeInTheDocument();
  });

  it('un backend anterior no manda `campaign`: se pinta el importe sin inventar un nombre', () => {
    render(
      <PackList packs={packCreditos({ campaignBonusAmount: 20 })} isPro={false} proExtraCreditsPercent={20} />,
    );

    // Nunca «la campaña «undefined»»: se dice lo único que se sabe con certeza.
    const linea = screen.getByTestId('pack-bonus-campana');
    expect(linea).toHaveTextContent('+ 20 por la campaña activa');
    expect(linea).not.toHaveTextContent('undefined');
  });
});

describe('BARRERA 7 — los BUMPS se comportan igual que los créditos', () => {
  it('un NO-Pro ve el regalo de la campaña de bumps y su total', () => {
    render(
      <BumpPackList
        packs={packBumps({ campaignBonusAmount: 10 })}
        isPro={false}
        proExtraBumpsPercent={20}
        campaign={{ name: 'Bumps de agosto', endsAt: '2026-09-15T00:00:00.000Z' }}
      />,
    );

    expect(screen.getByTestId('pack-bonus-campana')).toHaveTextContent(
      '+ 10 por la campaña «Bumps de agosto»',
    );
    expect(screen.getByTestId('pack-total')).toHaveTextContent('Recibes 30 bumps');
  });

  it('un PRO ve los dos, sumados — misma aritmética que en créditos', () => {
    render(
      <BumpPackList
        packs={packBumps({ campaignBonusAmount: 10 })}
        isPro
        proExtraBumpsPercent={20}
        campaign={{ name: 'Bumps de agosto', endsAt: '2026-09-15T00:00:00.000Z' }}
      />,
    );

    expect(screen.getByTestId('pack-bonus-pro')).toHaveTextContent('+ 4 de regalo por ser Pro');
    expect(screen.getByTestId('pack-total')).toHaveTextContent('Recibes 34 bumps'); // 20 + 4 + 10
  });

  it('SIMETRÍA — lo que una moneda enseña, la otra también', () => {
    // La asimetría entre créditos y bumps era del código, no del producto (ráfaga 4, E-4/E-5).
    // Este caso es el que impide que la campaña la reabra.
    const { unmount } = render(
      <PackList packs={packCreditos({ campaignBonusAmount: 20 })} isPro={false} campaign={CAMPANA} />,
    );
    expect(screen.getByTestId('pack-bonus-campana')).toBeInTheDocument();
    unmount();

    render(
      <BumpPackList
        packs={packBumps({ campaignBonusAmount: 10 })}
        isPro={false}
        proExtraBumpsPercent={20}
        campaign={CAMPANA}
      />,
    );
    expect(screen.getByTestId('pack-bonus-campana')).toBeInTheDocument();
  });
});

describe('El aviso de campaña — el contexto que la tarjeta no puede dar', () => {
  it('dice CUÁL campaña y HASTA CUÁNDO', () => {
    render(<CampaignNotice campaign={CAMPANA} moneda="créditos" />);

    const aviso = screen.getByTestId('campaign-notice-creditos');
    expect(aviso).toHaveTextContent('Vuelta al cole');
    expect(aviso).toHaveTextContent('créditos extra en cualquier pack');
    // El plazo es lo que convierte una promoción en un motivo para comprar hoy.
    expect(aviso).toHaveTextContent('15 de septiembre');
  });

  it('una fecha ilegible no rompe el aviso: se omite el plazo y lo demás sigue en pie', () => {
    render(<CampaignNotice campaign={{ name: 'Rara', endsAt: 'no-es-una-fecha' }} moneda="bumps" />);

    const aviso = screen.getByTestId('campaign-notice-bumps');
    expect(aviso).toHaveTextContent('Rara');
    expect(aviso).toHaveTextContent('bumps extra en cualquier pack');
    expect(aviso).not.toHaveTextContent('Invalid Date');
    expect(aviso).not.toHaveTextContent('NaN');
  });
});
