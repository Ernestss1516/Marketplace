import { AlertTriangle } from 'lucide-react';

/**
 * ÚLTIMA IP (5b) — UNA IP, CON LO QUE SE SABE Y LO QUE NO.
 *
 * ─── EL AVISO NO ES ADORNO (RC.1) ─────────────────────────────────────────────
 *
 * `pendientes.md` §6 tiene abierta una deuda de seguridad con nombre: el valor de
 * `trust proxy` **no está verificado contra la topología real de despliegue**, y si el
 * proxy reenvía el `X-Forwarded-For` que le manda el cliente en vez de sobrescribirlo,
 * **esta IP es falsificable a voluntad**. Hasta ahora eso sólo degradaba un rate limit
 * que tiene una red de seguridad global; con 5a la misma IP pasa a ser un dato de
 * moderación con el que una persona va a tomar decisiones sobre otra.
 *
 * La deuda no se puede cerrar sin desplegar (`pendientes.md` §1). Lo que sí se puede es
 * **no presentarla como un hecho firme**: una IP que puede mentir y se enseña como
 * certeza es peor que no enseñarla, porque invita a concluir. El aviso va donde está el
 * dato —no en una nota al pie que nadie lee— y desaparece solo cuando la deuda se cierre
 * (una línea, aquí).
 *
 * ─── LA PRIVACIDAD, RECORDADA DONDE SE EJERCE ────────────────────────────────
 *
 * Es un dato personal servido a MODERATOR+ por decisión escrita, con finalidad ÚNICA de
 * moderación antifraude (`docs/diseno-ultima-ip.md` §6). Y es la IP **del usuario o del
 * dueño del anuncio** — nunca la de `AuditLog`, que es la del staff y que 5a sacó de
 * estas respuestas precisamente porque es otro sujeto.
 */
export function DatoIp({ ip }: { ip: string | null | undefined }) {
  if (!ip) return <span className="text-muted-foreground">—</span>;

  return (
    <span className="inline-flex items-center gap-1.5" data-testid="dato-ip">
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{ip}</code>
      {/* El «por qué» viaja CON el dato, no en una leyenda aparte: quien lo lee para
          decidir algo tiene que ver aquí mismo hasta dónde puede fiarse. El `title` va en
          el `<span>` y no en el icono porque los de lucide no aceptan `title`. */}
      <span
        title={
          'Sin verificar: hasta confirmar la configuración del proxy en producción, esta ' +
          'IP podría estar falsificada por el cliente. Úsala como indicio, no como prueba.'
        }
        className="inline-flex items-center"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
        <span className="sr-only">
          IP sin verificar: podría estar falsificada mientras no se confirme la
          configuración del proxy.
        </span>
      </span>
    </span>
  );
}
