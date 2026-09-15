import { randomBytes } from 'crypto';

/**
 * EL ADMINISTRADOR DE LA SEMILLA — Y SU CREDENCIAL, QUE NO ESTÁ AQUÍ.
 *
 * Ver docs/auditoria-seed.md §4.2.
 *
 * ─── EL DEFECTO QUE ESTE FICHERO CIERRA ─────────────────────────────────────────
 *
 * `seedAdmin()` creaba `admin@marketplace.es` con la contraseña `Admin1234!` **escrita
 * en el código**. En un repositorio que alguien puede leer, eso significa que toda
 * instancia recién desplegada nace con una cuenta de administrador, con el correo ya
 * verificado, cuya contraseña es pública. Los 12 rounds de bcrypt no defienden nada:
 * no hay que romper el hash, hay que leer el fichero.
 *
 * ─── LA REGLA, Y ES DURA ────────────────────────────────────────────────────────
 *
 * **Cero credenciales en el código, en ningún entorno.** No hay un valor por defecto
 * «solo para desarrollo» escondido aquí abajo: un defecto cómodo es exactamente lo que
 * acaba desplegado, y ésta es la segunda vez que este repo aprende que lo que la semilla
 * no hace explícito, nadie lo hace después (la primera fue `videoEnabled`,
 * docs/auditoria-pro-video.md §2.0).
 *
 * ─── Y FAIL-SAFE, QUE ES LA OTRA MITAD ──────────────────────────────────────────
 *
 * Sin credencial configurada **no se crea ningún administrador**. No se inventa uno
 * «provisional», no se genera uno y se imprime, no se degrada a nada: la semilla sigue
 * con el resto (categorías, ajustes, catálogo) y avisa de qué falta y cómo darlo. Una
 * instancia sin admin es un problema de diez segundos; una instancia con un admin de
 * contraseña adivinable es un incidente.
 *
 * ─── DESARROLLO CÓMODO SIN CEDER NADA ───────────────────────────────────────────
 *
 * La comodidad de dev no está en un defecto: está en que el aviso **traiga la línea ya
 * escrita y con una contraseña fuerte recién generada**, lista para pegar en
 * `apps/api/.env`. Se tarda lo mismo que en copiar una constante, y lo que queda en la
 * máquina es distinto en cada una y no está en Git.
 *
 * En producción el aviso NO genera ninguna contraseña: lo último que debe hacer un
 * despliegue es dejar un secreto en los registros del arranque.
 *
 * ─── POR QUÉ VIVE EN SU PROPIO MÓDULO ───────────────────────────────────────────
 *
 * Mismo motivo que `SEED_SETTINGS` y que los bloques de la página de cookies: `seed.ts`
 * tiene un `main()` en la raíz, así que importarlo para mirar esta lógica ejecutaría la
 * semilla entera. Aquí es una función pura sobre un `env` que se le pasa —ni siquiera
 * lee `process.env` por su cuenta—, y por eso la barrera puede probar los cuatro
 * caminos sin base de datos y sin efectos.
 */

/** Los nombres de las dos variables. En un solo sitio: el aviso los imprime, la barrera los prueba. */
export const VAR_EMAIL_ADMIN = 'SEED_ADMIN_EMAIL';
export const VAR_PASSWORD_ADMIN = 'SEED_ADMIN_PASSWORD';

/**
 * Longitud mínima de la contraseña del administrador.
 *
 * No es el mínimo del registro público (ese lo fija su DTO): es el de la cuenta con
 * acceso al backoffice entero, que se configura una vez, a mano, desde un gestor de
 * secretos. Aquí un mínimo generoso no molesta a nadie y corta de raíz el «pongo algo
 * corto y ya lo cambiaré».
 */
export const LONGITUD_MINIMA_PASSWORD = 12;

/** Cuántos bytes de azar lleva la contraseña que se sugiere en desarrollo (24 → 32 caracteres base64url). */
const BYTES_SUGERENCIA = 24;

export type CredencialAdmin =
  /** Hay credencial y es utilizable: la semilla puede crear el administrador. */
  | { estado: 'ok'; email: string; password: string }
  /** No hay credencial. NO se crea ningún administrador. `aviso` explica cómo darla. */
  | { estado: 'sin-configurar'; aviso: string }
  /** Hay credencial pero no sirve (correo sin forma de correo, contraseña corta). Tampoco se crea. */
  | { estado: 'invalida'; aviso: string };

/**
 * Resuelve la credencial del administrador a partir del entorno.
 *
 * PURA a propósito: recibe el `env`, no lo lee. Así la barrera prueba producción y
 * desarrollo en el mismo proceso, sin tocar `process.env` ni la base de datos.
 */
export function resolverCredencialAdmin(env: NodeJS.ProcessEnv): CredencialAdmin {
  const produccion = env.NODE_ENV === 'production';
  const email = (env[VAR_EMAIL_ADMIN] ?? '').trim();
  // La contraseña NO se recorta: un espacio al final es parte de la contraseña, y
  // «arreglárselo» al operador haría que la que funciona no sea la que él escribió.
  const password = env[VAR_PASSWORD_ADMIN] ?? '';

  if (!email || !password) {
    return { estado: 'sin-configurar', aviso: avisoSinConfigurar({ email, password, produccion }) };
  }

  // Comprobación deliberadamente mínima: que sea un correo, no que exista. Validar de
  // más aquí sólo consigue rechazar direcciones legítimas raras.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      estado: 'invalida',
      aviso:
        `${VAR_EMAIL_ADMIN} no parece un correo electrónico («${email}»). ` +
        'No se ha creado ningún administrador.',
    };
  }

  if (password.length < LONGITUD_MINIMA_PASSWORD) {
    return {
      estado: 'invalida',
      aviso:
        `${VAR_PASSWORD_ADMIN} tiene ${password.length} caracteres y el mínimo son ` +
        `${LONGITUD_MINIMA_PASSWORD}. No se ha creado ningún administrador. ` +
        'Es la cuenta con acceso a todo el backoffice: dale una contraseña larga.',
    };
  }

  return { estado: 'ok', email, password };
}

/**
 * Una contraseña fuerte al azar, para SUGERIRLA en desarrollo.
 *
 * `base64url` y no `hex` para meter más entropía en menos caracteres, y sin `+`, `/`
 * ni `=`, que son justo los que se pelean con las comillas de un `.env`.
 */
export function sugerirPassword(): string {
  return randomBytes(BYTES_SUGERENCIA).toString('base64url');
}

function avisoSinConfigurar(args: { email: string; password: string; produccion: boolean }): string {
  const { email, password, produccion } = args;

  // Decir CUÁL falta, no «faltan variables»: media configuración es el caso típico
  // (alguien pone el correo y se deja la contraseña) y es el más frustrante de depurar.
  const faltan = [!email && VAR_EMAIL_ADMIN, !password && VAR_PASSWORD_ADMIN].filter(Boolean);

  const cabecera =
    `No se ha creado ningún administrador: falta ${faltan.join(' y ')}. ` +
    'La semilla NUNCA crea una cuenta con una contraseña por defecto.';

  if (produccion) {
    // NI UNA CONTRASEÑA EN LOS REGISTROS DE PRODUCCIÓN. El operador la saca de su
    // gestor de secretos; lo único que hace falta aquí es decirle qué poner y dónde.
    return (
      `${cabecera}\n` +
      `    Define ${VAR_EMAIL_ADMIN} y ${VAR_PASSWORD_ADMIN} en el entorno del despliegue ` +
      `(mínimo ${LONGITUD_MINIMA_PASSWORD} caracteres) y vuelve a ejecutar «prisma db seed».\n` +
      '    El resto de la semilla sí se ha aplicado: esto no bloquea el despliegue, pero ' +
      'sin administrador nadie puede entrar al backoffice.'
    );
  }

  return (
    `${cabecera}\n` +
    '    Para desarrollo, pega esto en apps/api/.env y vuelve a ejecutar «pnpm prisma db seed»:\n\n' +
    `      ${VAR_EMAIL_ADMIN}="admin@marketplace.local"\n` +
    `      ${VAR_PASSWORD_ADMIN}="${sugerirPassword()}"\n\n` +
    '    (Generada aquí mismo, distinta en cada máquina y fuera de Git — que es todo el punto.)'
  );
}
