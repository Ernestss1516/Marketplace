import { Role } from '@prisma/client';
import { ROLE_ORDER, atLeast, rolesFrom } from './role-hierarchy';

/**
 * ROLES RÁFAGA 1 — T3 del plan de verificación (docs/diseno-roles.md §6.1).
 *
 * Pinza la escalera: que sea total, transitiva, anidada y que CUBRA EL ENUM. Es
 * trivial de escribir y es lo que impide que alguien reordene `ROLE_ORDER` —o
 * añada un rol al schema— y lo rompa todo en silencio.
 *
 * Molde: `listing-status.transitions.ts` y su test — tabla pura, sin DI.
 */
describe('ROLE_ORDER — la escalera', () => {
  it('cubre EXACTAMENTE los valores del enum Role de Prisma', () => {
    // El caso peor que este test existe para atrapar: se añade un rol al schema y
    // nadie lo mete en la escalera. Sin esto, ese rol quedaría con nivel -1 —
    // fail-closed, sí, pero silencioso: nadie con ese rol entraría a ninguna
    // parte y no habría ni un error que lo explicara.
    expect([...ROLE_ORDER].sort()).toEqual(Object.values(Role).sort());
  });

  it('no tiene duplicados', () => {
    expect(new Set(ROLE_ORDER).size).toBe(ROLE_ORDER.length);
  });

  it('va de menor a mayor privilegio', () => {
    expect(ROLE_ORDER).toEqual([Role.USER, Role.EDITOR, Role.MODERATOR, Role.ADMIN]);
  });
});

describe('atLeast', () => {
  it('es reflexiva: todo rol se satisface a sí mismo', () => {
    for (const role of ROLE_ORDER) {
      expect(atLeast(role, role)).toBe(true);
    }
  });

  it('es transitiva sobre el orden de la escalera', () => {
    for (let i = 0; i < ROLE_ORDER.length; i++) {
      for (let j = 0; j < ROLE_ORDER.length; j++) {
        // atLeast(a, b) ⟺ nivel(a) >= nivel(b). Comprobado sobre las 16 parejas,
        // que es la tabla entera: no hay caso sin cubrir.
        expect(atLeast(ROLE_ORDER[i], ROLE_ORDER[j])).toBe(i >= j);
      }
    }
  });

  it('ADMIN satisface todos los pisos', () => {
    for (const min of ROLE_ORDER) {
      expect(atLeast(Role.ADMIN, min)).toBe(true);
    }
  });

  it('USER no satisface ningún piso de staff', () => {
    expect(atLeast(Role.USER, Role.EDITOR)).toBe(false);
    expect(atLeast(Role.USER, Role.MODERATOR)).toBe(false);
    expect(atLeast(Role.USER, Role.ADMIN)).toBe(false);
  });

  it('sin rol (null/undefined) no satisface ningún piso', () => {
    // El caso de la sesión sin rol. Antes se resolvía con un `?? ''` en AdminNav,
    // que dependía de que ningún rol se llamara ''.
    for (const min of ROLE_ORDER) {
      expect(atLeast(null, min)).toBe(false);
      expect(atLeast(undefined, min)).toBe(false);
    }
  });

  it('FAIL-CLOSED: un rol fuera de la escalera no satisface ningún piso', () => {
    const desconocido = 'SUPERUSER' as Role;
    for (const min of ROLE_ORDER) {
      expect(atLeast(desconocido, min)).toBe(false);
    }
  });
});

describe('rolesFrom', () => {
  it('expande cada piso a los roles que lo satisfacen', () => {
    expect(rolesFrom(Role.ADMIN)).toEqual([Role.ADMIN]);
    expect(rolesFrom(Role.MODERATOR)).toEqual([Role.MODERATOR, Role.ADMIN]);
    expect(rolesFrom(Role.EDITOR)).toEqual([Role.EDITOR, Role.MODERATOR, Role.ADMIN]);
    expect(rolesFrom(Role.USER)).toEqual([...ROLE_ORDER]);
  });

  it('produce conjuntos ANIDADOS: un piso más alto es subconjunto del más bajo', () => {
    // Es la propiedad que hace que la escalera sea una escalera. Si se rompiera,
    // «MODERATOR o superior» podría admitir a alguien que «EDITOR o superior» no
    // admite, y la jerarquía dejaría de ser un orden.
    for (let i = 1; i < ROLE_ORDER.length; i++) {
      const mayor = new Set(rolesFrom(ROLE_ORDER[i]));
      const menor = new Set(rolesFrom(ROLE_ORDER[i - 1]));
      for (const role of mayor) expect(menor.has(role)).toBe(true);
      expect(mayor.size).toBeLessThan(menor.size);
    }
  });

  it('es coherente con atLeast: lo que expande es exactamente lo que satisface', () => {
    for (const min of ROLE_ORDER) {
      const expandido = rolesFrom(min);
      for (const role of ROLE_ORDER) {
        expect(expandido.includes(role)).toBe(atLeast(role, min));
      }
    }
  });

  it('FAIL-CLOSED: un piso desconocido no expande a nadie', () => {
    expect(rolesFrom('SUPERUSER' as Role)).toEqual([]);
  });
});
