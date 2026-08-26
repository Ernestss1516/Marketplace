import { UserStatus } from '@prisma/client';
import {
  USER_STATUS_LABELS,
  USER_STATUS_TRANSITIONS,
  describeIllegalUserStatusTransition,
  isLegalUserStatusTransition,
} from './user-status.transitions';

/**
 * BORRADO DE CUENTAS C1 — BARRERA 2: la máquina de estados de una cuenta.
 *
 * Fichero puro, así que se prueba como tal (molde `media-keys.spec.ts` /
 * `category.types.spec.ts`), sin levantar la aplicación.
 */
describe('USER_STATUS_TRANSITIONS', () => {
  const TODOS = Object.values(UserStatus);

  it('cubre los cinco estados, sin sobrar ninguno', () => {
    expect(Object.keys(USER_STATUS_TRANSITIONS).sort()).toEqual([...TODOS].sort());
    expect(Object.keys(USER_STATUS_LABELS).sort()).toEqual([...TODOS].sort());
  });

  describe('lo que SÍ se puede', () => {
    it.each([
      ['ACTIVE', 'SUSPENDED'],
      ['ACTIVE', 'BANNED'],
      ['ACTIVE', 'ARCHIVED'],
      ['SUSPENDED', 'ACTIVE'],
      ['SUSPENDED', 'BANNED'],
      ['SUSPENDED', 'ARCHIVED'],
      ['BANNED', 'ACTIVE'],
      ['BANNED', 'ARCHIVED'],
      ['ARCHIVED', 'DELETED'],
    ] as [UserStatus, UserStatus][])('%s → %s', (from, to) => {
      expect(isLegalUserStatusTransition(from, to)).toBe(true);
    });

    /**
     * Los tres destinos de restauración. No se piden: `unarchive()` los LEE de
     * `User.statusBeforeArchive`. Que `ARCHIVED → BANNED` sea legal es justamente
     * lo que impide que archivar a un baneado le lave el ban.
     */
    it.each(['ACTIVE', 'SUSPENDED', 'BANNED'] as UserStatus[])(
      'ARCHIVED → %s (destino de restauración)',
      (destino) => {
        expect(isLegalUserStatusTransition('ARCHIVED', destino)).toBe(true);
      },
    );

    it('el no-op siempre es legal, incluso desde DELETED', () => {
      for (const s of TODOS) {
        expect(isLegalUserStatusTransition(s, s)).toBe(true);
      }
    });
  });

  describe('lo que NO se puede', () => {
    it('DELETED es TERMINAL: no sale a ningún otro estado', () => {
      for (const destino of TODOS.filter((s) => s !== 'DELETED')) {
        expect(isLegalUserStatusTransition('DELETED', destino)).toBe(false);
      }
      expect(USER_STATUS_TRANSITIONS.DELETED).toHaveLength(0);
    });

    /**
     * LOS DOS PASOS SON LA SALVAGUARDA (molde `deleteListing`): para vaciar una
     * cuenta hay que archivarla primero. Si esto se pusiera en verde, un solo clic
     * mal dado vaciaría una cuenta viva.
     */
    it.each(['ACTIVE', 'SUSPENDED', 'BANNED'] as UserStatus[])(
      '%s → DELETED es ilegal: hay que archivar primero',
      (from) => {
        expect(isLegalUserStatusTransition(from, 'DELETED')).toBe(false);
      },
    );

    it('BANNED → SUSPENDED es ilegal: rebajar la sanción son dos decisiones con dos roles', () => {
      expect(isLegalUserStatusTransition('BANNED', 'SUSPENDED')).toBe(false);
    });

    it('DELETED nunca es alcanzable salvo desde ARCHIVED', () => {
      const origenes = TODOS.filter((s) => USER_STATUS_TRANSITIONS[s].includes('DELETED'));
      expect(origenes).toEqual(['ARCHIVED']);
    });

    it('nadie vuelve a ARCHIVED desde DELETED', () => {
      expect(isLegalUserStatusTransition('DELETED', 'ARCHIVED')).toBe(false);
    });

    it('`statusBeforeArchive` nunca puede ser ARCHIVED ni DELETED: no son destinos de restauración', () => {
      // La tabla lo expresa por el otro lado: los destinos de ARCHIVED que no son
      // DELETED son exactamente los tres estados de sanción.
      const restauraciones = USER_STATUS_TRANSITIONS.ARCHIVED.filter((s) => s !== 'DELETED');
      expect([...restauraciones].sort()).toEqual(['ACTIVE', 'BANNED', 'SUSPENDED']);
    });
  });

  describe('el mensaje del 400 dice a qué SÍ se puede pasar', () => {
    it('desde un estado con salidas, las enumera', () => {
      const msg = describeIllegalUserStatusTransition('ACTIVE', 'DELETED');
      expect(msg).toContain('No se puede pasar de Activa a Eliminada');
      // Lo accionable: qué sí. Sin esto el 400 obliga a adivinar la tabla.
      expect(msg).toContain('Suspendida');
      expect(msg).toContain('Inhabilitada');
      expect(msg).toContain('Archivada');
    });

    it('desde el estado terminal, lo nombra en vez de enumerar la lista vacía', () => {
      const msg = describeIllegalUserStatusTransition('DELETED', 'ACTIVE');
      expect(msg).toContain('Eliminada es un estado final');
      expect(msg).not.toContain('solo se puede pasar a');
    });

    it('todas las etiquetas están en español y ninguna es el valor del enum', () => {
      for (const s of TODOS) {
        expect(USER_STATUS_LABELS[s]).not.toBe(s);
      }
    });
  });
});
