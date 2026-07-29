/** Origen del frontend por defecto en desarrollo — el `next dev -p 3000` del monorepo. */
export const DEFAULT_APP_ORIGIN = 'http://localhost:3000';

/**
 * Origen del frontend (`APP_URL`), en UNA SOLA definición.
 *
 * Existe como función y no solo como `config.appUrl` porque los decoradores de
 * Nest se evalúan al cargar la clase, antes de que exista el contenedor de
 * inyección: `@WebSocketGateway({ cors })` **no puede** recibir un
 * `ConfigService`. La alternativa era escribir `process.env.APP_URL ?? 'http://localhost:3000'`
 * otra vez en el decorador, con su default duplicado — y un default duplicado es
 * un default que un día se cambia en un sitio y no en el otro.
 *
 * `configuration.ts` (`appUrl`) llama a esta misma función, así que la
 * configuración de la aplicación y el CORS del gateway no pueden divergir: son
 * el mismo valor leído dos veces, no dos valores que se parecen.
 */
export function appOrigin(): string {
  return process.env.APP_URL ?? DEFAULT_APP_ORIGIN;
}
