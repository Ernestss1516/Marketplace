"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

/*
 * E6 · LA CAPA VUELVE A ANIMARSE, Y AHORA ES DEL MODELO.
 *
 * E0 quitó de aquí el bloque `animate-in` / `fade-in-0` / `zoom-in-95` que traía
 * shadcn: el plugin `tailwindcss-animate` NUNCA había estado instalado, así que
 * aquellas clases no generaban una sola línea de CSS y los diálogos aparecían en
 * seco. Se quitaron en vez de instalarlo porque instalarlo habría añadido animación
 * en la ráfaga cuyo único propósito era demostrar que nada cambiaba.
 *
 * Ahora el plugin está, y vuelve ATADO AL SISTEMA: `animate-in` dura
 * `var(--motion-duration)` —porque el plugin deriva su duración de
 * `transitionDuration`, que E3 fijó al token— y su curva es `var(--motion-ease)`
 * (declarada en `globals.css`). O sea que el TEMPO DE ESTA CAPA LO DECIDE EL MODELO,
 * y cada zona lo ajusta: 100 ms en el backoffice, 150 en el público.
 *
 * DOS AUSENCIAS DELIBERADAS respecto a lo que trae shadcn:
 *
 *  · `duration-200`. Estaba en la clase del contenido desde el principio y era
 *    inofensivo mientras el plugin no existía (sólo fijaba `transition-duration`, y
 *    aquí no hay transiciones). Con el plugin instalado pasa a fijar TAMBIÉN
 *    `animation-duration: 200ms`, que es exactamente sacar esta capa del sistema de
 *    tokens. Se quita.
 *  · `slide-in-from-top-[48%]`. El fotograma de entrada del plugin escribe un
 *    `transform: translate3d(...)` propio, que PISA el `translate-x-[-50%]
 *    translate-y-[-50%]` con el que este contenido se centra: el diálogo entraría
 *    descolocado y saltaría a su sitio al terminar. Se anima sólo opacidad y escala,
 *    que además es lo que corresponde a un Modelo 0 sobrio.
 */

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80",
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg sm:rounded-lg",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        {/* i18n T4 (L1) — sobrante de shadcn. Lo oye un lector de pantalla en TODOS los
            diálogos del sitio, así que un solo cambio aquí traduce decenas de pantallas. */}
        <span className="sr-only">Cerrar</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
