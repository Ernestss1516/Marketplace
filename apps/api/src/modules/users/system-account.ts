import { Prisma } from '@prisma/client';

/**
 * BORRADO DE CUENTAS C5 — LA CUENTA «EQUIPO».
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * Un editor que se elimina deja artículos publicados. Borrarlos sería destruir
 * contenido del SITIO por una decisión sobre una PERSONA, y dejarlos firmados por
 * «Usuario eliminado» convertiría el blog en un cementerio. La decisión (P-2) es
 * reasignarlos a una cuenta que representa a la casa.
 *
 * ── POR QUÉ SE RESUELVE PEREZOSAMENTE Y NO SÓLO EN EL SEED ──────────────────
 *
 * Porque el seed no basta para que siempre esté: `cleanDb` de los e2e hace
 * `TRUNCATE "User" CASCADE`, así que en cada suite desaparece. Una operación que
 * dependiera de que alguien la hubiera sembrado fallaría en la mitad de las
 * suites y funcionaría en la otra mitad — la peor clase de dependencia.
 *
 * `upsert` sobre el `slug`, que es único: dos eliminaciones simultáneas no pueden
 * crear dos cuentas. Y `update: {}` a propósito — si ya existe, **no se toca**:
 * esta función garantiza presencia, nunca corrige lo que haya.
 *
 * ── LA CUENTA NO PUEDE ENTRAR, Y ESO ES DELIBERADO ──────────────────────────
 *
 * `passwordHash: null` (no hay contraseña que probar) y un correo bajo
 * `.invalid`, el TLD que RFC 2606 reserva para que no exista: ningún mensaje
 * saldrá nunca hacia ahí. No es una cuenta de nadie, es una firma.
 *
 * Queda `ACTIVE` y visible en el escaparate a propósito: es la autora de los
 * artículos, y su nombre tiene que poder mostrarse donde se muestran los autores.
 */
export const EQUIPO_SLUG = 'equipo';
export const EQUIPO_EMAIL = 'equipo@sistema.invalid';
export const EQUIPO_NAME = 'Equipo';

/** Los datos de la cuenta, en un solo sitio para que el seed y la resolución
 *  perezosa no puedan divergir. */
export const EQUIPO_CREATE_DATA: Prisma.UserCreateInput = {
  email: EQUIPO_EMAIL,
  name: EQUIPO_NAME,
  slug: EQUIPO_SLUG,
  isSystem: true,
  emailVerified: true,
  // Sin contraseña y sin identidad social: no hay forma de entrar como Equipo.
  passwordHash: null,
  bio: 'Contenido publicado por el equipo del sitio.',
};
