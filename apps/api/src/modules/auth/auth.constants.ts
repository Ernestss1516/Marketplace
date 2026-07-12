// RÁFAGA 3 — paquete de seguridad de auth. Límites confirmados con el usuario.

// Login: por IP — flood-control genérico (429, no distingue cuenta-existe de
// cuenta-no-existe: misma clave, el email tal cual llega en el body, exista o
// no la cuenta). Deliberadamente generoso (150, no 10): un umbral bajo
// penaliza tráfico legítimo detrás de NAT/proxy compartido (oficinas, y aquí
// mismo: la propia batería e2e, que reutiliza una única IP de loopback para
// ~70 logins de setup repartidos en decenas de specs no relacionados con auth).
export const LOGIN_RATE_LIMIT_IP_PER_WINDOW = 150;
export const LOGIN_RATE_LIMIT_IP_WINDOW_SECONDS = 15 * 60;

// La defensa real contra fuerza bruta sobre UNA cuenta concreta es el lockout
// (más abajo), no un contador de rate-limit aparte: se probó un límite de 5
// intentos/email/15min que contaba TODOS los intentos (éxito incluido) — no
// solo los fallidos, como pedía el diseño original ("5 intentos FALLIDOS por
// cuenta") — y bloqueaba logins legítimos repetidos de una misma cuenta desde
// varios sitios (varios specs de la batería e2e comparten las cuentas
// sembradas y llaman a /auth/login más de 5 veces cada una en una corrida
// completa; en producción, el mismo patrón se daría con alguien logueado en
// varios dispositivos). El lockout ya cubre exactamente "5 fallos por cuenta"
// — con más matices (backoff creciente) y sin ese falso positivo, porque solo
// cuenta fallos, nunca éxitos.

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
