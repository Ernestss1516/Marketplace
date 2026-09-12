import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * ⚠ `ring-offset-background` — E14. ERA EL ÚNICO DE LOS DIEZ QUE NO LO LLEVABA.
 *
 * `ring-offset-2` dibuja una banda de 2 px entre el elemento y el anillo de foco, y su
 * color sale de `--tw-ring-offset-color`, que **por defecto es `#fff` literal**. Los otros
 * nueve componentes con anillo (`button`, `input`, `select`, `checkbox`, `radio-group`,
 * `textarea`, `dialog`…) declaran `ring-offset-background` para que esa banda sea el
 * lienzo del tema; éste se quedó sin ella desde que shadcn lo generó.
 *
 * Hoy no se nota y por eso nadie lo vio: el `--background` del Modelo 0 es `0 0% 100%`, el
 * mismo blanco. **En un tema de lienzo oscuro sería un halo blanco alrededor de cada
 * etiqueta enfocada** — y, peor, el anillo se estaría midiendo contra un vecino que el
 * sistema no controla, así que la barrera de contraste no podría cazarlo nunca.
 *
 * El cambio es un no-op exacto en claro (mismo blanco) y sólo afecta a `:focus`, que las
 * capturas no fotografían. Y no reorganiza nada: cambia una `class`, que es precisamente
 * lo que el test de invariancia ignora por ser el revestimiento.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ring-offset-background transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
