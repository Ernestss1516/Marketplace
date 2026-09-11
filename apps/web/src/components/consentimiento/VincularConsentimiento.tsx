'use client';

import { useEffect, useRef } from 'react';
import { vincularConsentimiento } from '@/lib/api/consentimiento';
import { leerConsentimiento } from '@/lib/consentimiento/cookie';

/**
 * COOKIES RÁFAGA 2 — ATA LA DECISIÓN ANÓNIMA A LA CUENTA QUE ACABA DE ENTRAR.
 *
 * Ver docs/diseno-consentimiento-cookies.md §2.4.
 *
 * ─── EL COSTE QUE LA RÁFAGA 1 DEJÓ ANOTADO, SALDADO ─────────────────────────────
 *
 * Allí la fila nacía sin `userId` porque traer la sesión al gate exigía `useSession()` o
 * un proveedor en la raíz —lo que rompía la hidratación—. La vía que quedaba escrita era
 * ésta: la cookie guarda el `id` del `ConsentRecord`, y con ese id el backend puede unir
 * las dos mitades cuando aparece una sesión.
 *
 * ─── NO PINTA NADA, Y VA DONDE EL `<Toaster/>` ──────────────────────────────────
 *
 * Hermano de `{children}` en el layout raíz, fuera de `AuthProvider`. El token llega como
 * `prop` desde el layout de servidor, que ya resolvió la sesión (`layout.tsx:77`): así
 * este componente no llama a `useSession()` ni arrastra next-auth a ningún bundle, y
 * sobre todo **no envuelve nada** — que es la condición que la ráfaga 1 dejó clara.
 *
 * ─── UNA VEZ POR CARGA, Y EL CORTE DE VERDAD ESTÁ EN EL SERVIDOR ────────────────
 *
 * El `ref` evita repetir la llamada si React vuelve a montar el componente. Pero la
 * garantía real es del backend: `vincularConUsuario` no escribe nada si esa cuenta ya
 * tiene una decisión registrada para esta versión del texto. Se hace así porque una marca
 * en el cliente (`sessionStorage`) se pierde al abrir otra pestaña y volvería a duplicar
 * filas en la tabla de la prueba.
 */
export function VincularConsentimiento({ token }: { token?: string }) {
  const yaIntentado = useRef(false);

  useEffect(() => {
    if (!token || yaIntentado.current) return;

    const consentimiento = leerConsentimiento();
    // Sin `id` no hay nada que unir: o no ha decidido todavía, o su decisión no llegó a
    // registrarse (el registro es fail-open, así que puede pasar).
    if (!consentimiento?.id) return;

    yaIntentado.current = true;
    // Silencioso a propósito: si falla, el usuario no tiene nada que hacer al respecto y
    // su consentimiento sigue siendo válido. Lo que se pierde es un detalle de la prueba,
    // no la decisión.
    void vincularConsentimiento(consentimiento.id, token);
  }, [token]);

  return null;
}
