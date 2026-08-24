import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

/**
 * LO QUE VE UN PRO CONCEDIDO POR EL EQUIPO — la rama que faltaba (§1.5, H-1).
 *
 * Antes, este usuario no entraba en ninguna de las dos ramas de la página y se quedaba con
 * la cabecera «Plan Pro» y nada debajo.
 *
 * QUÉ SE LE CUENTA Y QUÉ NO. Las tres cosas que le afectan: que lo tiene, hasta cuándo, y
 * que no se le cobra. NO el motivo interno ni quién se lo concedió — eso es la historia de
 * una decisión del equipo, vive en el `AuditLog` y se lee desde el backoffice.
 */
export function PlanConcedido({ expiresAt }: { expiresAt: string | null }) {
  const venceEl = expiresAt
    ? new Date(expiresAt).toLocaleDateString('es-ES', { dateStyle: 'long' })
    : null;

  return (
    <CardContent className="space-y-4" data-testid="pro-concedido">
      <Separator />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge variant="secondary">Concedido por el equipo</Badge>
        <span className="text-muted-foreground">
          {venceEl ? (
            <>
              Vence el <span className="font-medium text-foreground">{venceEl}</span>
            </>
          ) : (
            'Sin fecha de vencimiento'
          )}
        </span>
      </div>

      {/* Por qué no hay nada que gestionar, dicho con su nombre en vez de con un hueco. */}
      <p className="text-sm text-muted-foreground">
        Tienes todas las ventajas del plan Pro sin ninguna suscripción asociada: no se te
        cobra nada y no hay renovación automática, así que aquí no hay nada que gestionar.
        {venceEl ? ' Cuando llegue esa fecha volverás al plan gratuito, salvo que te suscribas.' : ''}
      </p>

      {/*
        Y el camino a pagarlo, que hasta H-2 estaba cerrado: `/planes` le deshabilitaba el
        botón por ser Pro. Ahora puede suscribirse de verdad, así que ofrecerlo aquí lleva a
        algo que funciona.
      */}
      <Button asChild variant="outline" size="sm">
        <Link href="/planes">Ver planes de pago</Link>
      </Button>
    </CardContent>
  );
}
