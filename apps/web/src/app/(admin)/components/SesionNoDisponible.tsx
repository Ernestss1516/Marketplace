import { Aviso } from '@/components/shared/Aviso';

/**
 * E0 — «Sesión no disponible», UNA VEZ.
 *
 * Las 29 pantallas del backoffice que necesitan el token de la sesión para hablar con la
 * API tienen todas la misma guarda al principio: si no hay token, en vez de lanzar una
 * petición sin credenciales se avisa y se para. El bloque estaba copiado **29 veces con
 * el mismo marcado Y EL MISMO TEXTO**, palabra por palabra.
 *
 * Que el texto también estuviera duplicado es lo que decide dónde vive esto. Un `<Aviso>`
 * genérico habría quitado el color repetido y dejado 29 copias de la frase: la próxima
 * vez que alguien la reescriba —o que haya que traducirla— seguirían siendo 29 sitios.
 * Aquí son uno.
 *
 * VIVE EN `(admin)/components` Y NO EN `components/shared` porque las 29 pantallas son de
 * esta zona, sin excepción: es vecina de `AdminNav`, `AdminUserBar` y `AdminSessionGuard`,
 * que es el sitio donde alguien la buscará. Si algún día la zona de cuenta necesitara lo
 * mismo, el que sube es `Aviso`, que ya es compartido.
 *
 * NO SUSTITUYE A `AdminSessionGuard`: aquél escucha los 401 de cualquier sección y los
 * convierte en re-login. Esto es la otra mitad —qué se pinta mientras tanto— y por eso son
 * dos cosas.
 */
export function SesionNoDisponible() {
  return <Aviso>Sesión no disponible. Recarga la página o inicia sesión de nuevo.</Aviso>;
}
