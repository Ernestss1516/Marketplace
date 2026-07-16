'use client';

import { createContext, useContext, useState } from 'react';
import { useMessagingSocket, type MessagePayload } from '@/hooks/useMessagingSocket';

interface MessagingSocketContextValue {
  /** El último mensaje recibido por la conexión compartida — cada consumidor
   * (ConversationList, ChatClient) filtra por el conversationId que le importa. */
  latestMessage: MessagePayload | null;
  /** Une la conexión compartida a la sala de esa conversación. Llamarlo NO
   * reconecta el socket — ver useMessagingSocket. */
  joinConversation: (conversationId: string) => void;
}

const MessagingSocketContext = createContext<MessagingSocketContextValue | null>(null);

export function useMessagingSocketContext(): MessagingSocketContextValue {
  const ctx = useContext(MessagingSocketContext);
  if (!ctx) {
    throw new Error('useMessagingSocketContext debe usarse dentro de MessagingSocketProvider');
  }
  return ctx;
}

/**
 * Mensajería — vista unificada: ÚNICO dueño de la conexión WebSocket para
 * toda la sesión de /mensajes (antes ConversationList y ChatClient abrían
 * cada uno la suya). Vive en MensajesShell, que a su vez vive en el layout —
 * no se remonta al cambiar de conversación, así que la conexión tampoco.
 */
export function MessagingSocketProvider({
  token,
  children,
}: {
  token: string;
  children: React.ReactNode;
}) {
  const [latestMessage, setLatestMessage] = useState<MessagePayload | null>(null);

  const { joinConversation } = useMessagingSocket({
    token,
    onMessage: (payload) => setLatestMessage(payload),
  });

  return (
    <MessagingSocketContext.Provider value={{ latestMessage, joinConversation }}>
      {children}
    </MessagingSocketContext.Provider>
  );
}
