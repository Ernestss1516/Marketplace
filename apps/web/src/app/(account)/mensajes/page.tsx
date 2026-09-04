import { Ilustracion } from '@/components/shared/Ilustracion';

/**
 * Estado vacío del panel de chat cuando no hay conversación seleccionada.
 * La lista y la conexión WebSocket ya viven en el layout — esta página solo
 * rellena el hueco derecho en escritorio (en móvil, MensajesShell oculta este
 * panel por completo cuando no hay selección, así que este contenido nunca
 * se ve ahí).
 */
export default function MensajesPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
      {/* E7 — la ilustración ocupa el hueco del icono (§8.1). */}
      <Ilustracion slot="empty-messages" className="h-auto w-full max-w-[180px]" />
      <p>Selecciona una conversación para ver los mensajes.</p>
    </div>
  );
}
