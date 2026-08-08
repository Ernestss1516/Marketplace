'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import { AccountNav } from './AccountNav';
import { findAccountNavItem } from '@/config/account-nav';

/**
 * UXV.2 (A3) — el menú de la cuenta en móvil.
 *
 * EL DEFECTO QUE CIERRA: el `<aside className="w-56 shrink-0">` del layout viejo no
 * tenía un solo breakpoint, así que en 375 px se llevaba 224 px de ancho y dejaba ~87 px
 * para el contenido. Tarjetas, wizard de edición y tablas de facturas eran inusables en
 * el dispositivo desde el que más se gestiona un marketplace.
 *
 * SHELL-D2 — drawer y no barra inferior: caben las TRECE entradas con sus grupos, y en
 * una barra inferior solo entran cuatro o cinco (habría que esconder el resto en un
 * «Más», reabriendo a medias el M2 que esta misma ráfaga cierra).
 *
 * Se monta sobre `@radix-ui/react-dialog`, YA instalado y ya usado por
 * [`components/ui/dialog.tsx`](../ui/dialog.tsx) — cero dependencias nuevas. No se reusa
 * `DialogContent` porque aquel centra un cuadro (`left-1/2 top-1/2 translate`) y esto es
 * un panel anclado al borde: mismo primitivo, distinta geometría. Overlay y animaciones
 * sí copian las suyas.
 */
export function AccountMobileBar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const section = findAccountNavItem(pathname);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <div className="mb-4 flex items-center gap-3 border-b pb-3 md:hidden">
        <DialogPrimitive.Trigger
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
          aria-label="Abrir el menú de mi cuenta"
        >
          <Menu className="h-4 w-4" aria-hidden />
          Mi cuenta
        </DialogPrimitive.Trigger>
        {/* Dónde estás, sin abrir nada: en móvil el menú está plegado, así que el
            estado activo del propio menú no basta para orientar (M1). */}
        {section && (
          <span className="truncate text-sm text-muted-foreground">{section.label}</span>
        )}
      </div>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] overflow-y-auto border-r bg-background p-4 shadow-lg duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left"
          aria-label="Menú de mi cuenta"
        >
          <div className="mb-4 flex items-center justify-between">
            <DialogPrimitive.Title className="text-base font-semibold">
              Mi cuenta
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
            Navegación entre las secciones de tu cuenta.
          </DialogPrimitive.Description>

          {/* Cerrar al navegar: sin esto el panel se queda abierto encima de la página
              nueva y hay que cerrarlo a mano en cada salto. */}
          <AccountNav onNavigate={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
