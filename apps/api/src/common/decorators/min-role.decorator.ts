import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';
import { rolesFrom } from '../roles/role-hierarchy';
import { ROLES_KEY } from './roles.decorator';

/**
 * ROLES — RÁFAGA 1. «Este endpoint pide ESTE rol o superior».
 *
 * AZÚCAR SOBRE `@Roles`, NO UN GUARD NUEVO. Escribe exactamente la misma metadata
 * (`ROLES_KEY`) con exactamente la misma forma (`Role[]`), expandida por
 * `rolesFrom`. `RolesGuard` no se ha tocado ni sabe que esto existe: sigue leyendo
 * `getAllAndOverride(ROLES_KEY, [handler, class])` y haciendo
 * `required.includes(user.role)`. Por eso este cambio es una refactorización con
 * equivalencia comprobable, y no un cambio de política:
 *
 *     @Roles(Role.EDITOR, Role.MODERATOR, Role.ADMIN)   ≡   @MinRole(Role.EDITOR)
 *     @Roles(Role.MODERATOR, Role.ADMIN)                ≡   @MinRole(Role.MODERATOR)
 *     @Roles(Role.ADMIN)                                ≡   @MinRole(Role.ADMIN)
 *
 * `min-role.decorator.spec.ts` pinza esas tres equivalencias sobre la metadata real.
 *
 * POR QUÉ NO SE ELIMINA `@Roles`. Porque hay un caso que NO es un piso y que se
 * seguiría expresando mal con éste: `moderation.controller.ts` restringe la clase a
 * MODERATOR+ y luego ABRE un método a `@Roles(USER, MODERATOR, ADMIN)` («cualquier
 * usuario autenticado puede denunciar»). Ese conjunto se salta EDITOR a propósito,
 * así que no es «USER o superior» — es un conjunto. Convivir es lo correcto:
 * `@MinRole` para pisos (la inmensa mayoría), `@Roles` para conjuntos.
 */
export const MinRole = (minRole: Role) => SetMetadata(ROLES_KEY, rolesFrom(minRole));
