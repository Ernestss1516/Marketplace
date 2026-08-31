/**
 * MIS-CRÉDITOS RÁFAGA B — LA ORGANIZACIÓN, y los cuatro datos que llegaban y no se pintaban.
 *
 * Lo que estos casos fijan, y por qué cada uno era un defecto real:
 *
 *   · EL SALDO ES LO PRIMERO. Lo era el formulario de canjear cupón: una caja para quien ya
 *     trae un código —una minoría— ocupaba el sitio de la cifra que busca el 100 % de las
 *     visitas.
 *   · EL SALDO CON SENTIDO. «150 créditos» no dice nada; «para 30 bumps o 5 destacados de 7
 *     días» sí. Los costes ya viajaban en el mismo `catalog` que la página pedía.
 *   · LA CUOTA PRO, VISIBLE. De `getProStatus` se usaba SÓLO `isPro`, y la cuota mensual es
 *     lo PRIMERO que se gasta al bumpear: la página lo decía con palabras mientras escondía
 *     el número.
 *   · EL `note` DEL LEDGER. El servidor escribe el motivo de cada apunte tocado por una
 *     campaña y la fila lo tiraba, así que un débito abaratado no se distinguía de uno raro.
 *
 * Ver docs/auditoria-mis-creditos.md §4, §5 y §7 (ráfaga B).
 */
import { render, screen, cleanup } from '@testing-library/react';
import type { CatalogResponse, ProStatus } from '@/lib/api/billing';
import { ResumenSaldo } from './ResumenSaldo';
import { HistorialCreditos, HistorialBumps } from './Historiales';
import { costeLabel, equivalenciasDeSaldo } from './saldo';

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { accessToken: 't' } }, status: 'authenticated' }),
}));

jest.mock('@/lib/api/billing', () => ({
  getWallet: jest.fn(),
  getBumpLedger: jest.fn(),
}));

/** Catálogo mínimo: bump a 5 cr. y las tres duraciones de destacado (7/14/30 d). */
const CATALOGO: CatalogResponse = {
  products: [
    {
      id: 'destacados',
      name: 'Destacado',
      description: null,
      type: 'ONE_TIME',
      prices: [
        { priceId: 'd7', amount: 4.99, currency: 'EUR', durationDays: 7, creditCost: 30 },
        { priceId: 'd14', amount: 8.99, currency: 'EUR', durationDays: 14, creditCost: 50 },
        { priceId: 'd30', amount: 14.99, currency: 'EUR', durationDays: 30, creditCost: 100 },
      ],
    },
  ],
  bumpCreditCost: 5,
  proExtraBumpsPercent: 20,
};

const proStatus = (over: Partial<ProStatus> = {}): ProStatus => ({
  isPro: false,
  limit: 0,
  used: 0,
  remaining: 0,
  bumpQuota: { limit: 0, used: 0, remaining: 0 },
  ...over,
});

const PRO_CON_CUOTA = proStatus({
  isPro: true,
  limit: 4,
  used: 2,
  remaining: 2,
  bumpQuota: { limit: 5, used: 1, remaining: 4 },
});

const pagina = <T,>(items: T[]) => ({ items, total: items.length, page: 1, perPage: 20, totalPages: 1 });

const apunte = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  walletId: 'w1',
  type: 'BUMP_DEBIT' as const,
  amount: -2,
  referenceId: 'listing-1',
  referenceType: 'Listing',
  note: null,
  createdAt: '2026-08-20T10:00:00.000Z',
  ...over,
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// BARRERA 5 — el saldo con contexto (la aritmética, aparte del render)
// ---------------------------------------------------------------------------

describe('BARRERA 5 — en qué se traduce el saldo', () => {
  it('divide el saldo entre los costes que publica el catálogo', () => {
    const { bump, destacado } = equivalenciasDeSaldo(150, CATALOGO);

    expect(bump.coste).toBe(5);
    expect(bump.veces).toBe(30); // 150 / 5
    // La variante MÁS BARATA, y se dice de cuántos días es: contar con la de 30 días daría
    // una cifra pesimista, y no decir la duración escondería que hay tres precios.
    expect(destacado?.coste).toBe(30);
    expect(destacado?.dias).toBe(7);
    expect(destacado?.veces).toBe(5); // 150 / 30
  });

  it('REDONDEA A LA BAJA: prometer un bump que el saldo no paga sería mentir', () => {
    expect(equivalenciasDeSaldo(14, CATALOGO).bump.veces).toBe(2); // 2,8 → 2, no 3
    expect(equivalenciasDeSaldo(0, CATALOGO).bump.veces).toBe(0);
  });

  it('un coste de 0 no da «infinitos»: no hay división, y la interfaz lo dirá con palabras', () => {
    // Alcanzable de verdad: un ACTION_DISCOUNT del 90 % sobre un bump de 5 deja
    // `floor(5 × 10 / 100)` = 0. Dividir ahí devolvería Infinity y la tarjeta enseñaría
    // «Para Infinity bumps».
    const gratis = equivalenciasDeSaldo(150, { ...CATALOGO, bumpCreditCost: 0 });
    expect(gratis.bump.veces).toBeNull();
  });

  it('sin precios de destacado en el catálogo, no se inventa ninguno', () => {
    expect(equivalenciasDeSaldo(150, { ...CATALOGO, products: [] }).destacado).toBeNull();
  });

  it('el coste ANUNCIA la rebaja de campaña, que la página también callaba', () => {
    const conRebaja = equivalenciasDeSaldo(150, {
      ...CATALOGO,
      bumpCreditCost: 2,
      bumpOriginalCreditCost: 5,
      bumpDiscountPercent: 60,
    });

    expect(conRebaja.bump.veces).toBe(75); // el saldo rinde más, y se ve
    expect(costeLabel(conRebaja.bump)).toBe('2 cr. (antes 5, −60%)');
    expect(costeLabel({ coste: 5, veces: 30 })).toBe('5 cr.');
  });
});

// ---------------------------------------------------------------------------
// La franja: barreras 4, 5 y 6
// ---------------------------------------------------------------------------

describe('La franja de saldo', () => {
  it('BARRERA 5 — enseña las dos monedas y en qué se traducen', () => {
    render(
      <ResumenSaldo balance={150} bumpBalance={3} proStatus={proStatus()} catalog={CATALOGO} />,
    );

    expect(screen.getByTestId('saldo-creditos')).toHaveTextContent('150');
    expect(screen.getByTestId('saldo-bumps')).toHaveTextContent('3');

    // El número deja de estar desnudo: dice para cuánto da y a qué precio.
    const equivalencias = screen.getByTestId('saldo-equivalencias');
    expect(equivalencias).toHaveTextContent('30 bumps');
    expect(equivalencias).toHaveTextContent('5 cr. cada uno');
    expect(equivalencias).toHaveTextContent('5 destacados de 7 días');
  });

  it('BARRERA 4 — un PRO ve su condición y el número de su cuota, no sólo el efecto', () => {
    render(
      <ResumenSaldo balance={10} bumpBalance={0} proStatus={PRO_CON_CUOTA} catalog={CATALOGO} />,
    );

    const pro = screen.getByTestId('resumen-pro');
    expect(pro).toHaveTextContent('Plan Pro');
    // La cuota de bumps es lo PRIMERO que se gasta al bumpear: era el número que faltaba.
    expect(screen.getByTestId('saldo-cuota-bumps')).toHaveTextContent('4');
    expect(screen.getByTestId('saldo-cuota-bumps')).toHaveTextContent('de 5 bumps');
    expect(pro).toHaveTextContent('2 de 4 destacados');
    expect(pro).toHaveTextContent('lo primero que se gasta al bumpear');
  });

  it('BARRERA 6 — un NO-Pro ve la franja entera, sin tarjeta Pro y sin hueco roto', () => {
    render(
      <ResumenSaldo balance={150} bumpBalance={3} proStatus={proStatus()} catalog={CATALOGO} />,
    );

    expect(screen.queryByTestId('resumen-pro')).not.toBeInTheDocument();
    // Lo demás sigue entero: no se degrada, simplemente hay una columna menos.
    expect(screen.getByTestId('saldo-creditos')).toHaveTextContent('150');
    expect(screen.getByTestId('saldo-bumps')).toHaveTextContent('3');
  });

  it('un PRO CONCEDIDO por el equipo ve su plan, pero no una cuota que no le aplica', () => {
    // D-1: la cuota mensual cuelga de un ciclo de facturación, y una concesión manual no lo
    // tiene. «0 de 0 restantes» le inventaría una carencia — no es que se le hayan agotado,
    // es que no le aplican. Mismo criterio que el aviso de /mis-anuncios.
    render(
      <ResumenSaldo
        balance={10}
        bumpBalance={0}
        proStatus={proStatus({ isPro: true })}
        catalog={CATALOGO}
      />,
    );

    expect(screen.getByTestId('resumen-pro')).toHaveTextContent('Activo');
    expect(screen.queryByTestId('saldo-cuota-bumps')).not.toBeInTheDocument();
  });

  it('con el bump rebajado a 0 por una campaña, lo dice con palabras y no con «Infinity»', () => {
    render(
      <ResumenSaldo
        balance={150}
        bumpBalance={0}
        proStatus={proStatus()}
        catalog={{ ...CATALOGO, bumpCreditCost: 0 }}
      />,
    );

    const equivalencias = screen.getByTestId('saldo-equivalencias');
    expect(equivalencias).toHaveTextContent('no cuesta créditos');
    expect(equivalencias).not.toHaveTextContent('Infinity');
    expect(equivalencias).not.toHaveTextContent('NaN');
  });
});

// ---------------------------------------------------------------------------
// BARRERA 3 — el `note` del ledger
// ---------------------------------------------------------------------------

describe('BARRERA 3 — el historial dice POR QUÉ, no sólo cuánto', () => {
  it('un débito abaratado por campaña muestra su motivo', () => {
    // Sin esto: «Bump · −2 cr.» donde otro día habría sido −5, sin explicación. El texto
    // que lo explica estaba guardado en la propia fila y se descartaba.
    render(
      <HistorialCreditos
        token="t"
        inicial={pagina([apunte({ note: 'Campaña "Vuelta al cole" (-60%)' })])}
      />,
    );

    expect(screen.getByTestId('ledger-note')).toHaveTextContent('Campaña "Vuelta al cole" (-60%)');
    // Y sigue diciendo lo de siempre: la nota se añade, no sustituye.
    expect(screen.getByText('Bump')).toBeInTheDocument();
  });

  it('sin nota, la fila queda exactamente como antes', () => {
    render(<HistorialCreditos token="t" inicial={pagina([apunte()])} />);

    expect(screen.queryByTestId('ledger-note')).not.toBeInTheDocument();
    expect(screen.getByText('Bump')).toBeInTheDocument();
  });

  it('el historial de BUMPS también: pintarla en uno y no en el otro reabriría la asimetría', () => {
    render(
      <HistorialBumps
        token="t"
        inicial={pagina([
          apunte({ type: 'CAMPAIGN_BONUS', amount: 10, note: 'Campaña "Bumps de agosto"' }),
        ])}
      />,
    );

    expect(screen.getByTestId('ledger-note')).toHaveTextContent('Campaña "Bumps de agosto"');
  });
});
