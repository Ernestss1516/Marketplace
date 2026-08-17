import { HttpStatus } from '@nestjs/common';
import { EmailVerifiedRule, EMAIL_NOT_VERIFIED_CODE } from './email-verified.rule';
import { ListingGateException, unicoMotivo } from '../listing-gate.exception';
import type { PrismaService } from '../../../infra/prisma/prisma.service';
import type { GateContext, GateTransition } from '../listing-gate.types';

/**
 * PUERTA regla #2 — las dos piezas de las que depende que la DEGRADACIÓN sea
 * segura, probadas donde viven.
 *
 * La degradación funciona así: la puerta rechaza como siempre, y `publish` —el
 * único camino que sabe degradar— reconoce ese rechazo concreto y lo convierte en
 * «te lo dejo en borrador». Eso descansa en dos invariantes:
 *
 *  1. El motivo NO PUEDE APARECER EN OTRO CAMINO (`appliesTo`). Si apareciera,
 *     ese otro camino devolvería un 4xx crudo en vez de degradar.
 *  2. El reconocimiento es EXACTO (`unicoMotivo`): con más motivos, el rechazo se
 *     propaga entero para que el vendedor los vea todos.
 *
 * Ampliar cualquiera de las dos rompe la degradación en silencio, así que las dos
 * están fijadas aquí.
 */

function rule(): EmailVerifiedRule {
  return new EmailVerifiedRule({} as PrismaService);
}

const ctx = (actor: GateContext['actor'], transition: GateTransition): GateContext => ({
  actor,
  transition,
  actorId: 'quien-sea',
});

describe('EmailVerifiedRule.appliesTo', () => {
  it('aplica al vendedor que PUBLICA', () => {
    expect(rule().appliesTo(ctx('seller', 'publish'))).toBe(true);
  });

  it('NO aplica a ninguna otra transición del vendedor', () => {
    // Renovar, reactivar o deshacer devuelven al mercado un anuncio que YA estuvo
    // publicado: retirarlo ahora porque su dueño no verificó el correo sería
    // aplicar la regla hacia atrás. Y `create` tampoco: redactar es libre.
    const otras: GateTransition[] = [
      'create',
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

  it('NO aplica a staff — la moderación no depende del correo del vendedor', () => {
    const deStaff: GateTransition[] = ['approve', 'restore', 'adminStatus'];
    for (const t of deStaff) {
      expect(rule().appliesTo(ctx('staff', t))).toBe(false);
    }
    expect(rule().appliesTo(ctx('staff', 'publish'))).toBe(false);
  });
});

describe('unicoMotivo — el reconocimiento del rechazo degradable', () => {
  const motivo = (code: string) => ({ code, message: `motivo ${code}` });

  function rechazo(...codes: string[]): ListingGateException {
    const reasons = codes.map(motivo);
    return new ListingGateException(reasons, HttpStatus.FORBIDDEN, 'x', 'y');
  }

  it('reconoce el rechazo que trae EXACTAMENTE ese motivo', () => {
    const r = unicoMotivo(rechazo(EMAIL_NOT_VERIFIED_CODE), EMAIL_NOT_VERIFIED_CODE);
    expect(r?.code).toBe(EMAIL_NOT_VERIFIED_CODE);
  });

  it('NO lo reconoce si viene acompañado de otro motivo', () => {
    // ES LA PROTECCIÓN QUE IMPORTA. Un vendedor sin verificar Y en el tope de su
    // plan tiene DOS problemas; degradar en silencio le escondería el segundo,
    // verificaría el correo y volvería a chocar.
    expect(
      unicoMotivo(rechazo(EMAIL_NOT_VERIFIED_CODE, 'ACTIVE_LIMIT_REACHED'), EMAIL_NOT_VERIFIED_CODE),
    ).toBeNull();
  });

  it('NO lo reconoce si el motivo es otro', () => {
    expect(unicoMotivo(rechazo('ACTIVE_LIMIT_REACHED'), EMAIL_NOT_VERIFIED_CODE)).toBeNull();
  });

  it('NO lo reconoce si el error no es de la puerta', () => {
    // Un fallo de red o de Prisma NUNCA puede acabar degradando en silencio.
    expect(unicoMotivo(new Error('la base de datos se cayó'), EMAIL_NOT_VERIFIED_CODE)).toBeNull();
    expect(unicoMotivo(null, EMAIL_NOT_VERIFIED_CODE)).toBeNull();
  });
});
