import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ROLE_ORDER, atLeast } from './roles';

/**
 * ROLES RÁFAGA 1 — T4 del plan de verificación: **LA BARRERA DEL ESPEJO**.
 *
 * `config/roles.ts` es un espejo de `apps/api/src/common/roles/role-hierarchy.ts`,
 * duplicado porque no hay paquete compartido — la misma razón que ya documentan
 * `lib/category-canonical.ts`, `lib/fiscal.ts` y `lib/attribute-schema.ts`.
 *
 * LA DIFERENCIA CON ESOS TRES es este fichero. Los espejos anteriores del repo se
 * sostienen sobre un comentario que pide buena fe; éste falla en CI si los dos
 * órdenes divergen. Es lo que convierte «duplicado a propósito» en «duplicado y
 * vigilado».
 *
 * SE LEE EL FICHERO DEL API COMO TEXTO, no se importa: `apps/web` no depende de
 * `apps/api` (son dos paquetes del workspace sin dependencia declarada, con
 * módulos incompatibles — CJS vs bundler) y crear esa dependencia para un test
 * acoplaría los dos grafos de build. Leer el fuente es suficiente: lo que hay que
 * detectar es que alguien edite un fichero y no el otro.
 */

const RUTA_CANONICO = join(
  __dirname,
  '..',
  '..',
  '..',
  'api',
  'src',
  'common',
  'roles',
  'role-hierarchy.ts',
);

/** Extrae el array `ROLE_ORDER` del fuente del api: `Role.USER, Role.EDITOR, …`. */
function ordenDelApi(): string[] {
  const fuente = readFileSync(RUTA_CANONICO, 'utf8');
  const bloque = /export const ROLE_ORDER[^=]*=\s*\[([\s\S]*?)\]/.exec(fuente);
  if (!bloque) throw new Error('No se ha encontrado ROLE_ORDER en el fichero canónico del api');
  return [...bloque[1].matchAll(/Role\.([A-Z_]+)/g)].map((m) => m[1]);
}

describe('espejo de la escalera api ↔ web', () => {
  it('el fichero canónico del api existe donde se espera', () => {
    // Si alguien lo mueve o lo renombra, este test lo dice en vez de dejar de
    // comprobar en silencio (que es lo que haría un `try/catch` complaciente).
    expect(existsSync(RUTA_CANONICO)).toBe(true);
  });

  it('ROLE_ORDER del web coincide EXACTAMENTE con el del api, incluido el orden', () => {
    // El orden es la política: invertirlo daría a USER los permisos de ADMIN.
    // Por eso se compara la lista tal cual y no como conjunto.
    expect([...ROLE_ORDER]).toEqual(ordenDelApi());
  });

  it('el espejo no tiene roles de más ni de menos', () => {
    const api = ordenDelApi();
    expect(new Set(ROLE_ORDER)).toEqual(new Set(api));
    expect(ROLE_ORDER.length).toBe(api.length);
  });
});

describe('atLeast — mismo comportamiento que el atLeast del api', () => {
  it('es reflexiva', () => {
    for (const role of ROLE_ORDER) expect(atLeast(role, role)).toBe(true);
  });

  it('es transitiva sobre el orden (las 16 parejas)', () => {
    for (let i = 0; i < ROLE_ORDER.length; i++) {
      for (let j = 0; j < ROLE_ORDER.length; j++) {
        expect(atLeast(ROLE_ORDER[i], ROLE_ORDER[j])).toBe(i >= j);
      }
    }
  });

  it('FAIL-CLOSED: sin rol, o con un rol fuera de la escalera, no satisface ningún piso', () => {
    for (const min of ROLE_ORDER) {
      expect(atLeast(null, min)).toBe(false);
      expect(atLeast(undefined, min)).toBe(false);
      expect(atLeast('', min)).toBe(false);
      expect(atLeast('SUPERUSER', min)).toBe(false);
      // El caso que el `?? ''` antiguo de AdminNav hacía depender del azar.
      expect(atLeast('admin', min)).toBe(false); // minúsculas: no es el enum
    }
  });
});
