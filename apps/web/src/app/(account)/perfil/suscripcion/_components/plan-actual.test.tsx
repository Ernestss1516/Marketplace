/**
 * H-1 — LA PÁGINA DE SUSCRIPCIÓN DEJABA EN BLANCO AL PRO CONCEDIDO.
 *
 * Tenía dos condiciones sueltas en el marcado —«hay suscripción» y «ni suscripción ni Pro»—
 * y entre ellas un hueco por el que se caía un caso real: el Pro concedido por el equipo, que
 * es Pro **sin** suscripción. Veía la cabecera «Plan Pro» y debajo, nada.
 *
 * Se prueban las DOS mitades del arreglo, porque el defecto tenía las dos:
 *   · la DECISIÓN (`resolverPlan`) — que los tres casos existen y son excluyentes;
 *   · el MARCADO (`PlanConcedido`) — que la rama nueva dice lo que tiene que decir.
 *
 * Ver docs/auditoria-pro-video.md §1.5.
 */
import { render, screen, cleanup } from '@testing-library/react';
import type { MyEntitlement, MySubscription } from '@/lib/api/billing';
import { resolverPlan } from './plan-actual';
import { PlanConcedido } from './PlanConcedido';

const SUSCRIPCION = {
  id: 'sub-1',
  status: 'ACTIVE',
  currentPeriodStart: '2026-08-01T00:00:00.000Z',
  currentPeriodEnd: '2026-09-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  price: { amount: 9.99, currency: 'EUR', interval: 'MONTH', product: { name: 'Plan Pro' } },
} as MySubscription;

function entitlementPro(overrides: Partial<MyEntitlement> = {}): MyEntitlement {
  return {
    id: 'ent-1',
    type: 'PRO_SUBSCRIPTION',
    startsAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-12-31T00:00:00.000Z',
    revokedAt: null,
    listingId: null,
    // `null` = concedido por el equipo; con valor = viene de un pago. ES la procedencia.
    subscriptionId: null,
    ...overrides,
  };
}

afterEach(cleanup);

describe('resolverPlan — los tres casos, y ninguno se cae por el hueco', () => {
  it('sin nada: GRATUITO', () => {
    expect(resolverPlan([], [])).toEqual({ tipo: 'GRATUITO' });
  });

  it('con suscripción: DE_PAGO, y lleva la suscripción para pintarla', () => {
    expect(resolverPlan([SUSCRIPCION], [])).toEqual({
      tipo: 'DE_PAGO',
      suscripcion: SUSCRIPCION,
    });
  });

  it('EL CASO QUE FALTABA — Pro sin suscripción: CONCEDIDO, con su vencimiento', () => {
    expect(resolverPlan([], [entitlementPro()])).toEqual({
      tipo: 'CONCEDIDO',
      expiresAt: '2026-12-31T00:00:00.000Z',
    });
  });

  it('un Pro concedido SIN vencimiento también es CONCEDIDO', () => {
    // El modelo admite `expiresAt: null` (Pro perpetuo). La página tiene que saber decirlo,
    // no quedarse muda por no tener fecha.
    expect(resolverPlan([], [entitlementPro({ expiresAt: null })])).toEqual({
      tipo: 'CONCEDIDO',
      expiresAt: null,
    });
  });

  it('un entitlement REVOCADO no cuenta: eso ya no es Pro', () => {
    const revocado = entitlementPro({ revokedAt: '2026-08-10T00:00:00.000Z' });
    expect(resolverPlan([], [revocado])).toEqual({ tipo: 'GRATUITO' });
  });

  it('un entitlement de DESTACADO no cuenta: no es el plan', () => {
    const destacado = entitlementPro({ type: 'FEATURED_LISTING', listingId: 'l1' });
    expect(resolverPlan([], [destacado])).toEqual({ tipo: 'GRATUITO' });
  });

  it('con las DOS cosas manda la suscripción: lo que hay que gestionar es el cobro', () => {
    // Un Pro de regalo encima de uno pagado no cambia lo que el usuario necesita ver aquí.
    const plan = resolverPlan([SUSCRIPCION], [entitlementPro()]);
    expect(plan.tipo).toBe('DE_PAGO');
  });

  it('el entitlement de un Pro DE PAGO no se confunde con uno concedido', () => {
    // Sin suscripción viva pero con un entitlement que SÍ cuelga de una: no es «concedido».
    // La marca es `subscriptionId`, no la ausencia de fila en `subscriptions`.
    const dePago = entitlementPro({ subscriptionId: 'sub-1' });
    expect(resolverPlan([], [dePago])).toEqual({ tipo: 'GRATUITO' });
  });
});

describe('PlanConcedido — lo que ve quien tiene Pro de regalo', () => {
  it('dice que lo tiene, hasta cuándo, y que no se le cobra', () => {
    render(<PlanConcedido expiresAt="2026-12-31T00:00:00.000Z" />);

    expect(screen.getByTestId('pro-concedido')).toBeInTheDocument();
    expect(screen.getByText('Concedido por el equipo')).toBeInTheDocument();
    expect(screen.getByText(/31 de diciembre de 2026/)).toBeInTheDocument();
    expect(screen.getByText(/no se te cobra nada/i)).toBeInTheDocument();
  });

  it('sin vencimiento lo dice, en vez de dejar el hueco', () => {
    render(<PlanConcedido expiresAt={null} />);
    expect(screen.getByText('Sin fecha de vencimiento')).toBeInTheDocument();
    // Y no promete una vuelta al plan gratuito que no va a ocurrir.
    expect(screen.queryByText(/volverás al plan gratuito/i)).not.toBeInTheDocument();
  });

  it('ofrece el camino a pagarlo — que hasta H-2 estaba cerrado', () => {
    render(<PlanConcedido expiresAt={null} />);
    expect(screen.getByRole('link', { name: 'Ver planes de pago' })).toHaveAttribute(
      'href',
      '/planes',
    );
  });

  it('NO cuenta el motivo interno ni quién lo concedió — no puede, ni recibiéndolo', () => {
    // El motivo y el actor son historia de una decisión del equipo: viven en el `AuditLog` y
    // se leen desde el backoffice. Al usuario se le cuenta lo que le afecta.
    //
    // Y la garantía es ESTRUCTURAL, no de redacción: la entrada entera de este componente es
    // `expiresAt`. Aunque alguien le pasara el motivo, no tendría por dónde entrar. Lo que
    // este caso fija es que no aparezca la etiqueta que lo delataría si algún día se cablea.
    const { container } = render(<PlanConcedido expiresAt="2026-12-31T00:00:00.000Z" />);
    expect(container.textContent).not.toMatch(/motivo/i);
    expect(container.textContent).not.toMatch(/\b(admin|moderador)\b/i);
  });
});
