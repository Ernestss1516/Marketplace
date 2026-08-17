import { MinPhotosRule } from './min-photos.rule';
import type { PrismaService } from '../../../infra/prisma/prisma.service';
import type { PhotoLimitsService } from '../photo-limits.service';
import type { GateContext, GateTransition } from '../listing-gate.types';

/**
 * MODERACIÓN M2 — la clasificación ANUNCIO vs VENDEDOR, fijada donde se declara.
 *
 * Es la línea entera de la ráfaga: en `approve` aplican las reglas sobre el
 * ANUNCIO y no las del VENDEDOR. Aquí se fija el lado del anuncio; el del
 * vendedor lo fijan `active-listing-limit` y `email-verified`, que NO incluyen
 * `approve` en su `appliesTo`, y el e2e lo comprueba de punta a punta.
 *
 * Ampliar esta lista a `renew`/`reactivate` aplicaría la regla hacia atrás sobre
 * anuncios publicados cuando no se exigía — el error que este spec impide.
 */

function rule(): MinPhotosRule {
  return new MinPhotosRule({} as PrismaService, {} as PhotoLimitsService);
}

const ctx = (actor: GateContext['actor'], transition: GateTransition): GateContext => ({
  actor,
  transition,
  actorId: 'quien-sea',
});

describe('MinPhotosRule.appliesTo — es una regla del ANUNCIO', () => {
  it('aplica cuando el VENDEDOR publica', () => {
    expect(rule().appliesTo(ctx('seller', 'publish'))).toBe(true);
  });

  it('aplica cuando el STAFF aprueba — es el otro momento en que sale al mercado', () => {
    expect(rule().appliesTo(ctx('staff', 'approve'))).toBe(true);
  });

  it('NO aplica a renovar ni reactivar: no se aplica hacia atrás', () => {
    const otras: GateTransition[] = ['renew', 'reactivate', 'undoDeal', 'closeDeal', 'create'];
    for (const t of otras) {
      expect(rule().appliesTo(ctx('seller', t))).toBe(false);
    }
  });

  it('NO aplica a promocionar: el anuncio ya está publicado', () => {
    expect(rule().appliesTo(ctx('seller', 'bump'))).toBe(false);
    expect(rule().appliesTo(ctx('seller', 'featured'))).toBe(false);
  });

  it('NO aplica a las demás acciones de staff', () => {
    // `restore` devuelve al mercado algo que ya estuvo publicado, y
    // `adminStatus` es la herramienta correctiva: ninguna es el momento en que
    // un anuncio se estrena.
    expect(rule().appliesTo(ctx('staff', 'restore'))).toBe(false);
    expect(rule().appliesTo(ctx('staff', 'adminStatus'))).toBe(false);
  });
});
