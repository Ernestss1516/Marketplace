import { Role } from '@prisma/client';

/**
 * ROLES — RÁFAGA 1 (EL MECANISMO). LA ESCALERA, declarada UNA sola vez.
 *
 * QUÉ DEFECTO CIERRA. `Role` es un enum PLANO (schema.prisma:38): cuatro valores
 * sin orden. El proyecto entero lo trataba como un conjunto, así que cada sitio
 * que autoriza ENUMERABA A MANO los roles admitidos — «MODERATOR o superior» se
 * escribía `@Roles(Role.MODERATOR, Role.ADMIN)`, y «EDITOR o superior»
 * `@Roles(Role.EDITOR, Role.MODERATOR, Role.ADMIN)`, esta última SIETE veces solo
 * en `blog-admin.controller.ts`.
 *
 * El problema de eso no es la verbosidad: es que **olvidar un rol en una de esas
 * listas no rompe nada visible**. Ese rol simplemente no entra, y nadie se entera
 * hasta que alguien lo reporta. Con la escalera, «o superior» se escribe una vez
 * (`@MinRole`) y la expansión la hace `rolesFrom` — no hay lista que olvidar.
 *
 * FICHERO PURO, SIN DI, a propósito — mismo molde que `listing-status.transitions.ts`
 * y `category.types.ts`: lo importan un decorador y varios controladores de módulos
 * que no se importan entre sí. Un servicio inyectable habría obligado a cablear un
 * módulo nuevo para una tabla de constantes.
 *
 * ES CANÓNICO AQUÍ, y `apps/web/src/config/roles.ts` es su ESPEJO. La autorización
 * es política de negocio, así que la escalera vive en el backend; el web necesita
 * la misma escalera para pintar el nav y decidir rutas, y no hay paquete compartido
 * (ver el comentario de `category-canonical.ts`). La diferencia con los espejos
 * anteriores del repo: éste **no se sostiene sobre un comentario**, sino sobre
 * `role-hierarchy.mirror.spec.ts`, que falla en CI si los dos ficheros divergen o
 * si el enum `Role` de Prisma crece y nadie mete el valor nuevo en la escalera.
 *
 * LA ESCALERA ES TOTAL Y SIN EXCEPCIONES: MODERATOR puede todo lo de EDITOR, y
 * ADMIN todo lo de MODERATOR. Se descartó un modelo de capacidades (matriz rol ×
 * acción) porque el reparto que este proyecto necesita ES una escalera, y una
 * matriz costaría un modelo de datos, un CRUD y una pantalla para expresar lo
 * mismo. Ver docs/diseno-roles.md §1 (Decisión 0.2).
 */

/**
 * De MENOR a MAYOR privilegio. El ÍNDICE es el nivel: comparar roles es comparar
 * posiciones en esta lista, y no hay ninguna otra fuente de ese orden.
 *
 * `USER` está incluido a propósito aunque no dé acceso a ninguna sección del
 * backoffice: es el piso cero, y su presencia hace que `atLeast` sea TOTAL — no
 * hay ningún valor de `Role` que la función no sepa comparar. Sin él, «¿es USER al
 * menos EDITOR?» tendría que responderse con un caso especial en cada llamante.
 *
 * ORDEN, NO CONJUNTO: reordenar esta lista cambia la política de acceso de todo el
 * backoffice. `role-hierarchy.spec.ts` la pinza (transitividad, anidamiento y
 * cobertura del enum) para que un reordenado accidental no pase en silencio.
 */
export const ROLE_ORDER: readonly Role[] = [
  Role.USER,
  Role.EDITOR,
  Role.MODERATOR,
  Role.ADMIN,
] as const;

/**
 * El nivel de un rol = su posición en `ROLE_ORDER`.
 *
 * FAIL-CLOSED: un rol que no esté en la escalera devuelve `-1`, y con eso
 * `atLeast` responde `false` contra cualquier piso. Es la respuesta correcta para
 * el único caso en que puede pasar —un valor nuevo del enum `Role` que nadie metió
 * aquí—: ante la duda, no se concede acceso. El test del espejo hace que esa
 * situación falle en CI antes de llegar a producción, pero el runtime no depende
 * de que el test exista.
 */
function levelOf(role: Role): number {
  return ROLE_ORDER.indexOf(role);
}

/**
 * ¿`role` está a la altura de `minRole` (es él mismo o superior)?
 *
 * Es la ÚNICA pregunta que hacen el middleware, el nav y los checks intra-sección
 * del web, y la que `rolesFrom` expande para el backend. Un solo predicado para
 * las tres capas.
 */
export function atLeast(role: Role | null | undefined, minRole: Role): boolean {
  if (!role) return false;
  const level = levelOf(role);
  // Un rol desconocido (level -1) no satisface ningún piso — ver levelOf.
  if (level < 0) return false;
  return level >= levelOf(minRole);
}

/**
 * Los roles que satisfacen el piso `minRole`, de menor a mayor.
 *
 * Es lo que convierte «rol mínimo» en la lista expandida que `RolesGuard` espera:
 * `rolesFrom(MODERATOR)` → `[MODERATOR, ADMIN]`. El guard NO cambia (sigue haciendo
 * `required.includes(user.role)`); lo que cambia es que la lista la genera esta
 * función en vez de escribirse a mano en cada decorador.
 */
export function rolesFrom(minRole: Role): Role[] {
  const min = levelOf(minRole);
  if (min < 0) return [];
  return ROLE_ORDER.filter((role) => levelOf(role) >= min);
}
