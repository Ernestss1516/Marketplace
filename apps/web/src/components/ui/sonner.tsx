'use client';

import { Toaster as SonnerToaster } from 'sonner';

/**
 * UXV.3 (M6) — el ÚNICO canal transversal de «esto ha pasado» de la aplicación.
 *
 * Antes no había ninguno: `useApiAction` solo tenía canal de error y cada pantalla se
 * inventaba el suyo — un `<p>` verde aquí, un `router.refresh()` mudo allá, y en tres
 * sitios nada en absoluto. De ahí salían M5 (destacar en silencio), M7 (emitir una
 * factura sin confirmar nada) y la mitad de A7.
 *
 * FEEDBACK-D1 — `sonner` y no `@radix-ui/react-toast`: es el toast por defecto de
 * shadcn/ui, que es lo que este repo ya usa, y se monta con un componente y una función.
 * El de Radix es el molde *legacy*: provider + viewport + hook con reducer para el mismo
 * resultado. Un paquete más en `package.json`, una pieza menos de infraestructura propia.
 *
 * Se envuelve en vez de usar `sonner` directo en el layout por dos razones: fija la
 * configuración en UN sitio (posición, duración, cierre) para que no diverja entre
 * llamadas, y deja el punto donde enganchar el tema si algún día el proyecto añade uno
 * (hoy no hay `next-themes`).
 *
 * DÓNDE SE USA: se monta UNA vez en el layout raíz, así que emite para toda la app
 * —pública, cuenta y backoffice—, no solo para la zona de vendedor.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      // `richColors` da a success/error su color semántico sin que cada llamada tenga que
      // pasar estilos — que es como se acaba con cinco verdes distintos.
      richColors
      closeButton
      // 5 s: lo bastante para leer «se han descontado N créditos» sin quedarse encima del
      // contenido. Los toasts de esta app informan de algo ya ocurrido; ninguno pide
      // decidir nada, así que no necesitan persistir.
      duration={5000}
      toastOptions={{ className: 'text-sm' }}
    />
  );
}
