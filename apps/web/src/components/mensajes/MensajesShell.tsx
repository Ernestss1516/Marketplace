'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { ConversationSummary } from '@/lib/api/mensajes';
import { MessagingSocketProvider } from './MessagingSocketContext';
import { ConversationList } from './ConversationList';

interface Props {
  initialConversations: ConversationSummary[];
  token: string;
  userId: string;
  children: React.ReactNode;
}

/**
 * Mensajería — vista unificada (bandeja + chat). Vive en el layout de
 * /mensajes, así que NO se remonta al navegar entre /mensajes y
 * /mensajes/[id] — la lista y la conexión WebSocket sobreviven a cada
 * selección de conversación (garantía de Next.js sobre layouts, no algo que
 * dependa de este componente).
 *
 * selectedId se lee de la URL (usePathname), no de props de Next.js: un
 * layout.tsx en /mensajes no recibe el segmento [id] de sus páginas hijas.
 *
 * Escritorio (≥768px): las dos columnas siempre visibles. Móvil (<768px):
 * una sola a la vez — la lista si no hay selección, `children` (el chat) si
 * la hay. Al ser rutas reales (no estado de cliente), el botón atrás nativo
 * del navegador ya hace lo correcto sin código adicional.
 */
export function MensajesShell({ initialConversations, token, userId, children }: Props) {
  const pathname = usePathname();
  // /mensajes → null; /mensajes/<id> → <id>
  const match = pathname.match(/^\/mensajes\/([^/]+)$/);
  const selectedId = match ? match[1] : null;

  // Sin conversaciones no hay nada que seleccionar — el panel de chat vacío
  // (children) no aporta nada al lado, así que el estado vacío ocupa todo el
  // ancho en vez de dejar una columna fija de 22rem sin sentido. Decisión
  // tomada sobre `initialConversations` (dato del layout, no reactivo al
  // socket): coherente con que la lista tampoco añade conversaciones nuevas
  // por WebSocket, solo actualiza las que ya existían al montar.
  if (initialConversations.length === 0) {
    return (
      <MessagingSocketProvider token={token}>
        <div className="h-[calc(100vh-14rem)] overflow-hidden rounded-lg border">
          <ConversationList initialConversations={[]} userId={userId} selectedId={null} />
        </div>
      </MessagingSocketProvider>
    );
  }

  return (
    <MessagingSocketProvider token={token}>
      <div className="grid h-[calc(100vh-14rem)] overflow-hidden rounded-lg border md:grid-cols-[22rem_1fr]">
        <div
          className={cn(
            'overflow-y-auto md:block md:border-r',
            selectedId ? 'hidden' : 'block',
          )}
        >
          <ConversationList
            initialConversations={initialConversations}
            userId={userId}
            selectedId={selectedId}
          />
        </div>
        {/* 'flex' vive SOLO en la rama condicional (no como clase base fija):
            una clase base 'flex' incondicional compitiendo con el 'hidden'
            condicional por la misma propiedad `display`, a igual
            especificidad, queda a merced del orden interno del CSS generado
            por Tailwind — en desktop no se nota (md:flex, con media query,
            gana siempre), pero en móvil (sin ese media query de por medio)
            puede ganar el que no toca y las dos columnas se ven a la vez. */}
        <div className={cn('flex-col overflow-hidden md:flex', selectedId ? 'flex' : 'hidden')}>
          {children}
        </div>
      </div>
    </MessagingSocketProvider>
  );
}
