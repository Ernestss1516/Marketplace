import { TotalListingLimitRule } from './total-listing-limit.rule';
import type { PrismaService } from '../../../infra/prisma/prisma.service';
import type { ProStatusService } from '../pro-status.service';
import type { GateContext, GateTransition } from '../listing-gate.types';

/**
 * PUERTA regla #1 — el `appliesTo`, que es donde viven DOS decisiones que ningún
 * e2e puede ejercitar hoy:
 *
 *  1. STAFF EXENTO. No hay ninguna ruta por la que un administrador cree un
 *     anuncio para otro (`POST /listings` siempre crea para el usuario
 *     autenticado), así que la exención es hoy INALCANZABLE desde HTTP. Eso no la
 *     hace decorativa: el día que exista una alta de staff —importaciones,
 *     migraciones, alta asistida— heredará la exención sin que nadie tenga que
 *     acordarse, igual que pasó con la cuota de activos. Lo que sí se puede es
 *     fijarla aquí, que es donde está escrita.
 *  2. SÓLO AL CREAR. El límite total no debe asomarse a publish/renew/bump: si
 *     lo hiciera, cobraría dos veces por el mismo anuncio.
 */

function rule(): TotalListingLimitRule {
  return new TotalListingLimitRule({} as PrismaService, {} as ProStatusService);
}

const ctx = (actor: GateContext['actor'], transition: GateTransition): GateContext => ({
  actor,
  transition,
  actorId: 'quien-sea',
});

describe('TotalListingLimitRule.appliesTo', () => {
  it('aplica al vendedor que CREA', () => {
    expect(rule().appliesTo(ctx('seller', 'create'))).toBe(true);
  });

  it('NO aplica a staff, ni siquiera creando', () => {
    expect(rule().appliesTo(ctx('staff', 'create'))).toBe(false);
  });

  it('NO aplica a ninguna otra transición del vendedor', () => {
    // Publicar, renovar, reactivar, deshacer, bumpear o destacar operan sobre
    // anuncios que YA cuentan en el total: frenarlos aquí sería cobrar dos veces.
    const otras: GateTransition[] = [
      'publish',
      'renew',
      'reactivate',
      'undoDeal',
      'closeDeal',
      'bump',
      'featured',
    ];
    for (const t of otras) {
      expect(rule().appliesTo(ctx('seller', t))).toBe(false);
    }
  });

  it('tampoco a las transiciones de staff', () => {
    const deStaff: GateTransition[] = ['approve', 'restore', 'adminStatus'];
    for (const t of deStaff) {
      expect(rule().appliesTo(ctx('staff', t))).toBe(false);
    }
  });
});
