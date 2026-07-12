// RÁFAGA 3 — paquete de seguridad de auth. Límites confirmados con el usuario.

// Login: por IP (protege contra fuerza bruta distribuida) y por email (protege
// una cuenta concreta aunque el atacante rote de IP). Ambos devuelven 429
// genérico — no distinguen cuenta-existe de cuenta-no-existe, se aplican con
// la misma clave (el email tal cual llega en el body) exista o no la cuenta.
//
// El límite por IP es deliberadamente generoso (150, no 10): la defensa real
// contra fuerza bruta sobre UNA cuenta es el límite por email (5) — el de IP
// es una red de flood-control más gruesa, y un umbral bajo penaliza tráfico
// legítimo detrás de NAT/proxy compartido (oficinas, y aquí mismo: la propia
// batería e2e, que reutiliza una única IP de loopback para ~70 logins de
// setup repartidos en decenas de specs no relacionados con auth).
export const LOGIN_RATE_LIMIT_IP_PER_WINDOW = 150;
export const LOGIN_RATE_LIMIT_IP_WINDOW_SECONDS = 15 * 60;
export const LOGIN_RATE_LIMIT_EMAIL_PER_WINDOW = 5;
export const LOGIN_RATE_LIMIT_EMAIL_WINDOW_SECONDS = 15 * 60;

// Register: anti-spam de cuentas, solo por IP (no hay "email existente" que
// proteger — el propio 409 de email duplicado ya es la defensa de esa cuenta).
export const REGISTER_RATE_LIMIT_IP_PER_HOUR = 3;
export const REGISTER_RATE_LIMIT_WINDOW_SECONDS = 3600;

// Forgot-password: anti-abuso de envío de correos, por IP y por email.
export const FORGOT_PASSWORD_RATE_LIMIT_IP_PER_HOUR = 5;
export const FORGOT_PASSWORD_RATE_LIMIT_EMAIL_PER_HOUR = 3;
export const FORGOT_PASSWORD_RATE_LIMIT_WINDOW_SECONDS = 3600;

// Change/set-password autenticados: menos crítico que login (ya hay sesión),
// pero se limita igual para no dejar un endpoint autenticado sin ningún techo.
export const CHANGE_PASSWORD_RATE_LIMIT_PER_HOUR = 5;
export const CHANGE_PASSWORD_RATE_LIMIT_WINDOW_SECONDS = 3600;

// Lockout: a partir del intento nº LOCKOUT_THRESHOLD, se bloquea la cuenta con
// backoff exponencial (15min → 30min → 60min…), con techo en LOCKOUT_MAX_MINUTES.
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_BASE_MINUTES = 15;
export const LOCKOUT_MAX_MINUTES = 24 * 60;

/** Duración (minutos) del bloqueo dado el nº de intentos fallidos acumulados
 * (ya incluyendo el intento actual). Escala en potencias de 2 cada
 * LOCKOUT_THRESHOLD intentos extra por encima del umbral, con techo. */
export function computeLockoutMinutes(failedAttempts: number): number {
  const over = Math.max(0, failedAttempts - LOCKOUT_THRESHOLD);
  const minutes = LOCKOUT_BASE_MINUTES * 2 ** Math.floor(over / LOCKOUT_THRESHOLD);
  return Math.min(minutes, LOCKOUT_MAX_MINUTES);
}
