import { MessageCircle } from 'lucide-react';

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
      <MessageCircle className="h-10 w-10" />
      <p>Selecciona una conversación para ver los mensajes.</p>
    </div>
  );
}
