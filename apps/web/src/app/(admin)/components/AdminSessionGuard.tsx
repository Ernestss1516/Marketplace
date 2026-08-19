'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { AUTH_EXPIRED_EVENT } from '@/lib/api/client';
import { backofficeLoginPathFor } from '@/config/backoffice-sections';
import { isSafeCallbackUrl } from '@/lib/auth/callback-url';

/**
 * ROLES R3 — EL TRADUCTOR DE 401 DEL BACKOFFICE.
 *
 * QUÉ HUECO CIERRA. `useApiAction` es el único sitio del proyecto que convierte
 * un 401 en `signOut` + vuelta al login, y su propio contrato lo dice
 * («Client components should call signOut() and redirect to /login when this is
 * true», en `isAuthError`). Pero el backoffice **no pasa por ahí**: los 74
 * ficheros `.tsx` de `(admin)` llaman a `apiFetch` con su propio `try/catch` y
 * pintan el error crudo. Verificado: cero usos de `useApiAction` en `(admin)`.
 *
 * Sin esto, la mitad de R3 sería contraproducente: invalidar el token al cambiar
 * un rol dejaría al afectado mirando un «Error 401: Session invalidated» en cada
 * panel, sin forma de salir salvo borrar la cookie a mano. La frescura y su
 * manejo van juntos o no van.
 *
 * POR QUÉ UN OYENTE Y NO MIGRAR LAS 74 PANTALLAS. Migrarlas a `useApiAction` es
 * la limpieza correcta, pero es un cambio de 74 ficheros con riesgo repartido, y
 * lo que este cuerpo necesita es UNA salida garantizada para el 401. Esto es un
 * componente montado una vez en el shell: cubre todas las secciones —incluidas
 * las que aún no existen— sin tocar ninguna. La migración queda como deuda de
 * limpieza, no como requisito de seguridad.
 *
 * ES SÓLO PARA `(admin)`. La zona de cuenta ya tiene su traductor y no se toca:
 * dos manejadores compitiendo por el mismo evento producirían dos `signOut`.
 */
export function AdminSessionGuard() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user.role;

  // Refs y no estado: el oyente se registra UNA vez y debe leer siempre el valor
  // actual. Con dependencias en el efecto, cada navegación dentro del backoffice
  // desmontaría y volvería a montar el oyente, y un 401 emitido justo en ese
  // hueco se perdería.
  const pathnameRef = useRef(pathname);
  const roleRef = useRef(role);
  pathnameRef.current = pathname;
  roleRef.current = role;

  /** Una sesión sólo se cierra una vez. Ver el comentario del efecto. */
  const cerrando = useRef(false);

  useEffect(() => {
    function alCaducarLaSesion() {
      // Una pantalla del backoffice lanza varias peticiones a la vez (la lista, el
      // contador, el detalle). Si el token acaba de morir, TODAS devuelven 401 y
      // emiten el evento: sin este cerrojo se encadenarían varios `signOut` y el
      // usuario vería la navegación saltar dos o tres veces.
      if (cerrando.current) return;
      cerrando.current = true;

      // `signOut` borra la cookie de NextAuth y navega. El destino se elige con
      // el rol de la sesión que MUERE, que es lo correcto aunque esté caducado:
      // describe por qué puerta entró esta persona, y es la que su cuenta admite
      // mientras el backend no diga otra cosa. Se vuelve al login con la ruta
      // actual como `callbackUrl`, así que quien conserve el permiso aterriza
      // donde estaba y quien lo haya perdido lo descubre al instante — el
      // middleware lo saca del backoffice con su rol ya fresco.
      const destino = backofficeLoginPathFor(roleRef.current);
      const volverA = pathnameRef.current;
      // `usePathname` siempre devuelve una ruta interna, pero el `callbackUrl`
      // acaba en la barra de direcciones y de ahí lo lee `resolveCallbackUrl`:
      // se pasa por el mismo filtro anti-open-redirect que el resto del sitio.
      const callbackUrl = isSafeCallbackUrl(volverA)
        ? `${destino}?callbackUrl=${encodeURIComponent(volverA)}`
        : destino;
      void signOut({ callbackUrl });
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, alCaducarLaSesion);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, alCaducarLaSesion);
  }, []);

  return null;
}
