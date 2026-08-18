/**
 * ROLES — RÁFAGA 1. LA ESCALERA, lado web.
 *
 * ESPEJO de `apps/api/src/common/roles/role-hierarchy.ts`, que es el CANÓNICO: la
 * autorización es política de negocio y vive en el backend (regla del proyecto:
 * «NestJS es la única fuente de verdad de la lógica de negocio»). El web necesita
 * la misma escalera para decidir rutas en el middleware, filtrar el nav y resolver
 * los checks intra-sección — y no hay paquete compartido. Duplicado aquí por lo
 * mismo que el resto de espejos api↔web (ver `lib/category-canonical.ts`,
 * `lib/fiscal.ts`, `lib/attribute-schema.ts`).
 *
 * LA DIFERENCIA CON LOS ESPEJOS ANTERIORES DEL REPO: éste no se sostiene sobre
 * este comentario. `roles.mirror.test.ts` lee el fichero del api y falla en CI si
 * los dos órdenes divergen. Es la barrera que convierte el acuerdo de caballeros
 * en una garantía.
 *
 * NO SE IMPORTA `Role` DE `@prisma/client` a propósito: `apps/web` no depende del
 * cliente de Prisma (no debe: es presentación), y la sesión de NextAuth trae el rol
 * como `string`. El tipo se declara aquí y el test comprueba que coincide con el
 * enum real.
 */

export const ROLE_ORDER = ['USER', 'EDITOR', 'MODERATOR', 'ADMIN'] as const;

export type Role = (typeof ROLE_ORDER)[number];

/**
 * FAIL-CLOSED: un rol que no esté en la escalera —o ausente, que es el caso de una
 * sesión sin `role`— no satisface ningún piso. Antes esto se resolvía con un
 * `?? ''` en `AdminNav`, que dependía de que ningún rol se llamara `''`.
 */
export function atLeast(role: string | null | undefined, minRole: Role): boolean {
  if (!role) return false;
  const level = (ROLE_ORDER as readonly string[]).indexOf(role);
  if (level < 0) return false;
  return level >= (ROLE_ORDER as readonly string[]).indexOf(minRole);
}
