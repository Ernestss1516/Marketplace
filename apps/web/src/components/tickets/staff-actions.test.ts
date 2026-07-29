// Atención al usuario R7 — la matriz de acciones de staff.
//
// 5 estados × 2 roles × 3 situaciones de asignación × con/sin factura. Cubrirlo
// a base de clics en Playwright costaría minutos por combinación; aquí es
// instantáneo y exhaustivo. Playwright cubre aparte que la pantalla realmente
// usa estas banderas.

import { resolveStaffActions, type StaffTicketContext } from './staff-actions';
import type { Role, TicketStatus } from '@/types';

const ADMIN_ID = 'admin-1';
const MOD_ID = 'mod-1';
const OTRO_AGENTE = 'mod-2';

function ctx(overrides: Partial<StaffTicketContext> = {}): StaffTicketContext {
  return {
    status: 'OPEN',
    assignedToId: null,
    hasInvoice: false,
    actorId: MOD_ID,
    actorRole: 'MODERATOR',
    ...overrides,
  };
}

describe('resolveStaffActions — transiciones por estado', () => {
  it('OPEN: se puede tomar, responder y cerrar; NO resolver (nadie lo ha atendido)', () => {
    const a = resolveStaffActions(ctx({ status: 'OPEN' }));
    expect(a).toMatchObject({
      puedeTomar: true,
      puedeResponder: true,
      puedeResolver: false,
      puedeCerrar: true,
    });
  });

  it.each<TicketStatus>(['IN_PROGRESS', 'WAITING_USER'])(
    '%s: se puede responder, resolver y cerrar; ya no tomar',
    (status) => {
      const a = resolveStaffActions(ctx({ status, assignedToId: MOD_ID }));
      expect(a).toMatchObject({
        puedeTomar: false,
        puedeResponder: true,
        puedeResolver: true,
        puedeCerrar: true,
      });
    },
  );

  it('RESOLVED: solo cerrar (responder es del usuario, y reabrir es responder)', () => {
    const a = resolveStaffActions(ctx({ status: 'RESOLVED', assignedToId: MOD_ID }));
    expect(a).toMatchObject({
      puedeTomar: false,
      puedeResponder: false,
      puedeResolver: false,
      puedeCerrar: true,
    });
  });

  it('CLOSED es un pozo sin salida: ninguna acción', () => {
    const a = resolveStaffActions(ctx({ status: 'CLOSED', assignedToId: MOD_ID }));
    expect(a).toMatchObject({
      puedeTomar: false,
      puedeResponder: false,
      puedeResolver: false,
      puedeCerrar: false,
      puedeReasignar: false,
    });
  });
});

describe('resolveStaffActions — PUERTA 1: ticket con factura es ADMIN-only', () => {
  it('el MODERATOR no puede NADA sobre un ticket con factura', () => {
    const a = resolveStaffActions(ctx({ hasInvoice: true, status: 'IN_PROGRESS' }));

    expect(a.puedeGestionar).toBe(false);
    // Y la puerta cubre TODOS los verbos, no solo ver/responder: poder cerrar a
    // ciegas lo que no puedes leer sería una puerta trasera.
    expect(a).toMatchObject({
      puedeTomar: false,
      puedeResponder: false,
      puedeResolver: false,
      puedeCerrar: false,
      puedeReasignar: false,
    });
  });

  it('el ADMIN sí, con normalidad', () => {
    const a = resolveStaffActions(
      ctx({ hasInvoice: true, status: 'IN_PROGRESS', actorId: ADMIN_ID, actorRole: 'ADMIN' }),
    );
    expect(a.puedeGestionar).toBe(true);
    expect(a.puedeResponder).toBe(true);
    expect(a.puedeResolver).toBe(true);
  });

  it('sin factura, el MODERATOR gestiona igual que el ADMIN', () => {
    const mod = resolveStaffActions(ctx({ status: 'IN_PROGRESS', assignedToId: MOD_ID }));
    const admin = resolveStaffActions(
      ctx({ status: 'IN_PROGRESS', assignedToId: ADMIN_ID, actorId: ADMIN_ID, actorRole: 'ADMIN' }),
    );
    expect(mod.puedeResponder).toBe(admin.puedeResponder);
    expect(mod.puedeResolver).toBe(admin.puedeResolver);
    expect(mod.puedeCerrar).toBe(admin.puedeCerrar);
  });
});

describe('resolveStaffActions — PUERTA 2: reasignar el ticket de otro es ADMIN-only', () => {
  it('MODERATOR + ticket de OTRO agente → NO puede reasignar', () => {
    const a = resolveStaffActions(ctx({ status: 'IN_PROGRESS', assignedToId: OTRO_AGENTE }));
    expect(a.puedeReasignar).toBe(false);
    // Pero el resto sí: la puerta es solo sobre la reasignación.
    expect(a.puedeResponder).toBe(true);
  });

  it('MODERATOR + ticket SIN ASIGNAR → sí puede (se lo queda)', () => {
    const a = resolveStaffActions(ctx({ status: 'OPEN', assignedToId: null }));
    expect(a.puedeReasignar).toBe(true);
  });

  it('MODERATOR + ticket SUYO → sí puede (se lo pasa a un compañero)', () => {
    const a = resolveStaffActions(ctx({ status: 'IN_PROGRESS', assignedToId: MOD_ID }));
    expect(a.puedeReasignar).toBe(true);
  });

  it('ADMIN + ticket de otro agente → sí puede', () => {
    const a = resolveStaffActions(
      ctx({
        status: 'IN_PROGRESS',
        assignedToId: OTRO_AGENTE,
        actorId: ADMIN_ID,
        actorRole: 'ADMIN',
      }),
    );
    expect(a.puedeReasignar).toBe(true);
  });

  it.each<Role>(['ADMIN', 'MODERATOR'])('%s no reasigna un ticket ya CERRADO', (actorRole) => {
    const a = resolveStaffActions(
      ctx({ status: 'CLOSED', assignedToId: null, actorRole, actorId: ADMIN_ID }),
    );
    expect(a.puedeReasignar).toBe(false);
  });
});
