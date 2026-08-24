import { Prisma, SubscriptionStatus } from '@prisma/client';

/**
 * «¿ESTE USUARIO TIENE UNA SUSCRIPCIÓN DE PAGO VIVA?» — una sola definición.
 *
 * NO ES LA MISMA PREGUNTA QUE «¿ES PRO?», y confundirlas es de donde salen los dos huecos
 * que este fichero ayuda a cerrar. Ser Pro lo dice un `Entitlement`
 * (`ProStatusService.isProActive`); tener suscripción lo dice una fila de `Subscription`.
 * Un Pro CONCEDIDO A MANO por el equipo es Pro **sin** suscripción — y el backend siempre
 * lo tuvo claro; era la interfaz la que fundía los dos ejes en un solo `isPro`.
 *
 * POR QUÉ EXISTE ESTE FICHERO. El predicado vivía escrito a mano dentro del guard
 * `ALREADY_SUBSCRIBED` de `createCheckoutSession`, y ahora lo necesita también el estado que
 * consume la interfaz para decidir si enseña «Ya eres Pro» o «Hazte Pro». Si los dos sitios
 * llevaran su propia copia podrían separarse, y separarse significa **ofrecer un checkout
 * que el servidor va a rechazar** (o esconder uno que aceptaría). La interfaz tiene que
 * ofrecer exactamente lo que el backend acepta, así que los dos leen de aquí.
 *
 * QUÉ CUENTA COMO VIVA, y por qué `PAST_DUE` NO está:
 *   · `ACTIVE`    — paga y está al día.
 *   · `CANCELING` — cancelada pero vigente hasta fin de periodo. Sigue siendo Pro, y
 *     suscribirse otra vez solaparía dos cobros.
 *   · `PAST_DUE`  — el cobro FALLÓ y la suscripción está en el aire. Aquí sí se le deja
 *     rehacerla: bloquearlo lo dejaría sin salida. Es la decisión que ya tomaba el guard, y
 *     compartir el predicado es lo que hace que la interfaz la respete sin saberla.
 *
 * Ver docs/auditoria-pro-video.md §1.5 (H-1 y H-2).
 */
export const ESTADOS_DE_SUSCRIPCION_VIGENTE = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.CANCELING,
] as const;

export function suscripcionVigenteFilter(userId: string): Prisma.SubscriptionWhereInput {
  return { userId, status: { in: [...ESTADOS_DE_SUSCRIPCION_VIGENTE] } };
}
