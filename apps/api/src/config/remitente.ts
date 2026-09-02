/**
 * El remitente de fábrica: un PLACEHOLDER con pinta de dominio real.
 *
 * En UNA SOLA definición, por el mismo motivo que `app-origin.ts`: estaba escrito a mano en
 * `configuration.ts` (como valor por defecto de `RESEND_FROM`) y otra vez en
 * `instance-info.service.ts` (para poder avisar de que lo es). Dos copias de la misma cadena
 * son dos sitios donde cambiarla, y el día que sólo se cambie uno el aviso del panel de
 * instancia deja de avisar sin que nada se ponga rojo.
 *
 * Ahora tiene un tercer lector, y es el que de verdad lo cierra: la validación de entorno
 * RECHAZA este valor en producción (`env.validation.ts`). Que sea obligatorio definir
 * `RESEND_FROM` no basta —se puede definir copiándolo del `.env.example`—, así que se prohíbe
 * el valor concreto. Ver docs/auditoria-despliegue.md §3.2.
 */
export const REMITENTE_PLACEHOLDER = 'noreply@tudominio.es';
