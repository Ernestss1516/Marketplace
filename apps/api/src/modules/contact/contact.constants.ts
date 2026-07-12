// RC.1 — formulario de contacto público. Confirmados con el usuario:
// 5 envíos/hora por IP, 200/hora global. El límite global NO depende de la IP
// — es la red de seguridad si el rate-limit por IP resulta falsificable (ver
// nota en main.ts sobre TRUST_PROXY_HOPS: solo es fiable si el proxy real
// SOBRESCRIBE X-Forwarded-For en vez de reenviar la cabecera del cliente tal
// cual; verificar el comportamiento del proxy en despliegue, no asumir).
export const CONTACT_RATE_LIMIT_IP_PER_HOUR = 5;
export const CONTACT_RATE_LIMIT_GLOBAL_PER_HOUR = 200;
export const CONTACT_RATE_LIMIT_WINDOW_SECONDS = 3600;

// Time-trap: ventana de envío válida tras emitir el token.
export const CONTACT_TIME_TRAP_MIN_ELAPSED_MS = 3_000;
export const CONTACT_TIME_TRAP_MAX_ELAPSED_MS = 2 * 60 * 60 * 1000;

// Campo señuelo del honeypot — un humano nunca lo rellena (oculto por CSS en
// el formulario, nunca type="hidden").
export const CONTACT_HONEYPOT_FIELD = 'empresa';
