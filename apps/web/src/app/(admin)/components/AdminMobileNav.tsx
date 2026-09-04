'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import { AdminNav } from './AdminNav';
import { BrandLogo } from '@/components/layout/BrandLogo';
import { sectionForPath } from '@/config/backoffice-sections';
import type { BrandMark } from '@/lib/brand';

/*
 * E6 · LA CAPA VUELVE A ANIMARSE, Y AHORA ES DEL MODELO.
 *
 * E0 quitó de aquí el bloque que traía shadcn porque `tailwindcss-animate` no estaba
 * instalado: aquellas clases no generaban una línea de CSS y la capa aparecía en seco.
 * El plugin ya está, y la animación vuelve ATADA AL SISTEMA — dura
 * `var(--motion-duration)` y usa `var(--motion-ease)`, así que el tempo lo decide el
 * modelo y cada zona lo ajusta (100 ms en el backoffice, 150 en el público).
 *
 * Ver el comentario largo de `dialog.tsx` para las dos ausencias deliberadas —el
 * `duration-200`, que con el plugin puesto sacaría esta capa del sistema de tokens, y
 * el `slide-in-from-top-[48%]`, cuyo `transform` pisa el centrado— y
 * docs/diseno-sistema-estilo.md §6.3.
 */

/**
 * PUNTO 3 (A3) — EL MENÚ DEL BACKOFFICE EN MÓVIL.
 *
 * EL DEFECTO QUE CIERRA, que es LITERALMENTE el A3 que UXV.2 ya cerró en la zona de
 * cuenta y que aquí seguía sin arreglar: el `<aside className="w-56 shrink-0">` del
 * shell no tenía un solo breakpoint, así que en 375 px se llevaba 224 px y dejaba —con
 * el `p-8` del `<main>` restando 64 más— unos 87 px útiles. El backoffice era
 * inusable en el dispositivo desde el que más se moderan cosas fuera de la oficina.
 *
 * DRAWER Y NO BARRA INFERIOR, mismo argumento que SHELL-D2 y más fuerte todavía: en
 * una barra inferior entran cuatro o cinco destinos de VEINTIDÓS, y el resto acabaría
 * detrás de un «Más» — que es el defecto R3 con otro nombre.
 *
 * Se monta sobre `@radix-ui/react-dialog`, YA instalado y ya usado por
 * `components/ui/dialog.tsx` y por `AccountMobileBar` — cero dependencias nuevas. No
 * se reusa `DialogContent` porque aquel centra un cuadro (`left-1/2 top-1/2
 * translate`) y esto es un panel anclado al borde: mismo primitivo, distinta
 * geometría. Overlay y animaciones sí copian las suyas.
 *
 * DÓNDE VIVE EL DISPARADOR, y es la única divergencia con el molde: `AccountMobileBar`
 * mete su botón dentro del `<main>` porque la zona de cuenta no tiene cabecera propia.
 * El backoffice **sí la tiene** (`layout.tsx`), así que el botón va ahí, donde el
 * usuario ya mira para orientarse.
 */
export function AdminMobileNav({ marca }: { marca: BrandMark }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const section = sectionForPath(pathname);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2 md:hidden">
        <DialogPrimitive.Trigger
          className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          aria-label="Abrir el menú del backoffice"
        >
          <Menu className="h-4 w-4" aria-hidden />
        </DialogPrimitive.Trigger>
        {/* Dónde estás, sin abrir nada: en móvil el menú está plegado, así que el
            estado activo del propio menú no basta para orientar. */}
        {section && (
          <span className="max-w-[45vw] truncate text-sm text-muted-foreground">
            {section.label}
          </span>
        )}
      </div>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        {/* EL CAJÓN DEL BACKOFFICE ES EL MÁS SOBRIO DE LOS DOS, y es donde se ve la
            doctrina de la zona: «una herramienta responde, no se luce» (§6.1). Entra
            deslizándose 2 unidades, no el ancho entero del panel, y sobre el tempo de
            100 ms que la zona `backoffice` fija en el modelo. El de la cuenta, que es
            la misma pieza en una zona menos austera, entra desde el borde. */}
        <DialogPrimitive.Content
          /**
           * ⚠ `data-zona` AQUÍ, Y NO ES REDUNDANTE — llegó midiendo.
           *
           * Los tokens de zona se declaran en un `[data-zona="backoffice"]` que envuelve
           * el árbol del backoffice, y funcionan por herencia de custom properties. Pero
           * este cajón NO es descendiente de ese div: Radix lo cuelga de `<body>` por un
           * portal, o sea FUERA de la zona. Medido con una sonda: el cajón heredaba
           * `--motion-duration: 150ms` (la base) mientras la página estaba en una zona
           * que lo baja a 100.
           *
           * Marcar el propio contenido con la zona lo arregla sin inventar nada: el
           * bloque `[data-zona="backoffice"]` pasa a casar con este elemento, y las
           * custom properties mandan en su subárbol. Es el mecanismo de E5 aplicado
           * donde el portal lo había roto, no un mecanismo nuevo.
           */
          data-zona="backoffice"
          className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] overflow-y-auto border-r bg-background p-4 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-left-2 data-[state=closed]:slide-out-to-left-2"
          aria-label="Menú del backoffice"
        >
          <div className="mb-4 flex items-center justify-between">
            {/* LOGOS L2 — el SEGUNDO sitio de la marca del backoffice, y cambia con el
                primero: la cabecera de escritorio está oculta por debajo de `md`, así
                que en móvil éste es el ÚNICO sitio donde se ve de qué instancia es el
                panel. Radix exige un `Title` para nombrar el diálogo; con logo, ese
                nombre lo da el `alt` de la imagen, que es la misma cadena que el texto
                de respaldo (ver `BrandMark.text`). */}
            <DialogPrimitive.Title className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <BrandLogo mark={marca} imgClassName="h-7 w-auto max-w-[150px] object-contain" />
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="rounded-sm opacity-70 transition-opacity hover:opacity-100"
              aria-label="Cerrar el menú"
            >
              <X className="h-4 w-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          {/* Radix exige una descripción (o declararla ausente) o avisa por consola. */}
          <DialogPrimitive.Description className="sr-only">
            Navegación entre las secciones del backoffice.
          </DialogPrimitive.Description>

          {/* Cerrar al navegar: sin esto el panel se queda abierto encima de la página
              nueva y hay que cerrarlo a mano en cada salto. */}
          <AdminNav onNavigate={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
