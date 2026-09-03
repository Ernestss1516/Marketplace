import Header from '@/components/layout/Header';
import { AccountNav } from '@/components/cuenta/AccountNav';
import { AccountMobileBar } from '@/components/cuenta/AccountMobileBar';
import { AccountBreadcrumbs } from '@/components/cuenta/AccountBreadcrumbs';

/**
 * UXV.2 — el SHELL de la zona de cuenta.
 *
 * LO QUE HABÍA: treinta y cuatro líneas — `<div flex><aside w-56><main>` — sin cabecera,
 * sin responsive y sin estado. Tres defectos de raíz salían de aquí:
 *
 * - **A1**: `<Header/>` se montaba en UN solo sitio de todo `apps/web`, el layout
 *   público. Desde que el usuario entraba en `/mis-anuncios` no tenía ninguna vía de UI
 *   para volver a la portada — ni logo, ni buscador, ni campana, ni avatar. Solo el
 *   botón atrás del navegador.
 * - **A3**: el `<aside>` no llevaba un solo breakpoint. En 375 px se quedaba con 224 px
 *   y dejaba ~87 px de contenido.
 * - **M1/M2**: nueve enlaces planos, sin marcar el activo, y sin cuatro destinos de la
 *   propia zona.
 *
 * SHELL-D1 — se REUSA la `Header` pública en vez de escribir una de cuenta. Es un Server
 * Component `async` con dos fetches propios (contador de no leídas + avatar); pagarlos
 * aquí es el precio de que el usuario recupere la campana y el buscador dentro de su
 * cuenta, que es justamente parte del desconcierto de A1. Un segundo componente de
 * cabecera es lo que produjo los tres shells incompatibles de hoy.
 *
 * SIN `Footer`, a propósito: la zona de cuenta es una herramienta de trabajo, no una
 * página de navegación.
 *
 * ESTE LAYOUT ES COMÚN A LAS VEINTE PANTALLAS de la zona (anuncios, editar, saldo,
 * perfil, facturación, suscripción, tickets, mensajes, alertas, favoritos,
 * notificaciones, publicar). No lleva lógica de ninguna: solo el contenedor.
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col" data-zona="cuenta">
      <Header />

      <div className="container mx-auto flex flex-1 gap-8 px-4 py-6 md:py-8">
        {/*
          `hidden md:block` es la mitad de A3 que arregla el ancho: por debajo de `md`
          el aside NO ocupa sitio en la fila y el `<main>` se queda con el ancho
          completo. La otra mitad es el drawer de abajo, que da acceso al mismo menú
          sin robar columna.
        */}
        <aside className="hidden w-56 shrink-0 md:block">
          <div className="sticky top-20">
            <AccountNav />
          </div>
        </aside>

        {/*
          `min-w-0` NO es decorativo. Un hijo de flex tiene `min-width: auto`, así que se
          niega a encogerse por debajo de su contenido: sin esto, una tabla de facturas o
          una tarjeta ancha desbordarían el contenedor y el <body> scrollaría en
          horizontal en móvil, que es otra forma del mismo problema que A3.
        */}
        <main className="min-w-0 flex-1">
          <AccountMobileBar />
          <AccountBreadcrumbs />
          {children}
        </main>
      </div>
    </div>
  );
}
