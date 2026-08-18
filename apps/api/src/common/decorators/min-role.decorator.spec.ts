import { Role } from '@prisma/client';
import { MinRole } from './min-role.decorator';
import { Roles, ROLES_KEY } from './roles.decorator';

/**
 * ROLES RÁFAGA 1 — LA PRUEBA DEL «BYTE-IDÉNTICO» EN EL BACKEND.
 *
 * Esta ráfaga sustituyó ~40 decoradores `@Roles(...)` por `@MinRole(...)` en 16
 * controladores. Ese cambio es seguro SÓLO si los dos escriben la misma metadata,
 * porque `RolesGuard` no se ha tocado y lee exactamente esa metadata.
 *
 * Este test lo comprueba sobre las TRES equivalencias que realmente se aplicaron,
 * leyendo la metadata igual que la lee el guard. Si `rolesFrom` o `ROLE_ORDER`
 * cambiaran de forma que alguna dejara de valer, aquí se ve — y no en producción,
 * con un rol que entra o deja de entrar donde no debe.
 */

/** Lee la metadata de un decorador de clase igual que lo hace el Reflector de Nest. */
function metadataDeClase(decorator: ClassDecorator): unknown {
  class Objetivo {}
  decorator(Objetivo);
  return Reflect.getMetadata(ROLES_KEY, Objetivo);
}

describe('@MinRole ≡ @Roles (las tres equivalencias que aplicó la ráfaga)', () => {
  it('@MinRole(EDITOR) escribe lo mismo que @Roles(EDITOR, MODERATOR, ADMIN)', () => {
    expect(metadataDeClase(MinRole(Role.EDITOR))).toEqual(
      metadataDeClase(Roles(Role.EDITOR, Role.MODERATOR, Role.ADMIN)),
    );
  });

  it('@MinRole(MODERATOR) escribe lo mismo que @Roles(MODERATOR, ADMIN)', () => {
    expect(metadataDeClase(MinRole(Role.MODERATOR))).toEqual(
      metadataDeClase(Roles(Role.MODERATOR, Role.ADMIN)),
    );
  });

  it('@MinRole(ADMIN) escribe lo mismo que @Roles(ADMIN)', () => {
    expect(metadataDeClase(MinRole(Role.ADMIN))).toEqual(metadataDeClase(Roles(Role.ADMIN)));
  });

  it('escribe bajo la MISMA clave que lee RolesGuard', () => {
    // Si la clave divergiera, el guard no encontraría metadata y `!required?.length`
    // lo dejaría pasar todo: un decorador que no protege nada, en silencio. Es el
    // peor fallo posible de este refactor y por eso se afirma explícitamente.
    class Objetivo {}
    MinRole(Role.ADMIN)(Objetivo);
    expect(Reflect.getMetadata('roles', Objetivo)).toEqual([Role.ADMIN]);
  });

  it('la metadata es un Role[] plano, la forma que espera el guard', () => {
    const meta = metadataDeClase(MinRole(Role.MODERATOR));
    expect(Array.isArray(meta)).toBe(true);
    expect(meta).toEqual([Role.MODERATOR, Role.ADMIN]);
  });
});
