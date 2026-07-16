'use client';

import { useCallback, useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ChatMessage } from '@/lib/api/mensajes';

export interface MessagePayload {
  conversationId: string;
  message: ChatMessage;
}

interface Options {
  token: string;
  onMessage: (payload: MessagePayload) => void;
}

/**
 * Mensajería — vista unificada: UNA sola conexión por sesión de /mensajes,
 * propiedad de MensajesShell (antes cada componente abría la suya — dos
 * conexiones en dos páginas separadas nunca coincidían, pero en el split
 * habrían coexistido y una se habría reconectado en cada clic de conversación).
 *
 * `joinConversation` es imperativo (no un prop que fuerce reconexión): unirse
 * a una sala nueva NO tira la conexión existente. Recuerda todas las salas
 * unidas en la sesión para volver a unirlas tras una reconexión (antes solo
 * recordaba una, porque solo podía haber una conversación abierta a la vez).
 */
export function useMessagingSocket({ token, onMessage }: Options): {
  joinConversation: (conversationId: string) => void;
} {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const socketRef = useRef<Socket | null>(null);
  const joinedRoomsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3001';
    const socket: Socket = io(`${WS_URL}/ws`, {
      auth: { token },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    // 'connect' fires on initial connect AND on every successful reconnect —
    // re-join every room this session has ever selected, not just the last one.
    socket.on('connect', () => {
      for (const conversationId of joinedRoomsRef.current) {
        socket.emit('conversation:join', { conversationId });
      }
    });

    socket.on('message:new', (payload: MessagePayload) => {
      onMessageRef.current(payload);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // Reconnect only when the token changes (login/logout) — NOT on conversation
    // selection, that's what joinConversation is for.
  }, [token]);

  const joinConversation = useCallback((conversationId: string) => {
    joinedRoomsRef.current.add(conversationId);
    socketRef.current?.emit('conversation:join', { conversationId });
  }, []);

  return { joinConversation };
}
