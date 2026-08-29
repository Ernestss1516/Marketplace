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
  setActiveConversation: (conversationId: string | null) => void;
} {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const socketRef = useRef<Socket | null>(null);
  const joinedRoomsRef = useRef<Set<string>>(new Set());

  /**
   * NOTIFICACIONES N4b — EL HILO QUE SE ESTÁ MIRANDO AHORA. Uno, no un conjunto.
   *
   * Es la diferencia con `joinedRoomsRef`, y es toda la razón de que exista: aquel
   * `Set` **sólo crece** (guarda cada sala para poder re-unirse tras una
   * reconexión), así que responde «¿ha abierto este hilo?», no «¿lo está mirando?».
   * El backend usaba eso para decidir si notificar, y con tres hilos abiertos
   * habría silenciado los avisos de dos — en silencio.
   *
   * Se guarda además del `emit` para poder REENVIARLO al reconectar, igual que las
   * salas: sin eso, una reconexión dejaría al servidor creyendo que no se está
   * mirando nada y empezaría a notificar un hilo que está abierto delante.
   */
  const activeRef = useRef<string | null>(null);

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
      // Y el hilo activo, que el servidor perdió con la conexión anterior.
      socket.emit('conversation:active', { conversationId: activeRef.current });
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

  /**
   * Qué hilo se está mirando. `null` al salir de la conversación.
   *
   * A diferencia de `joinConversation`, esto SE SOBRESCRIBE: no hay conjunto que
   * acumular ni un `leave` que se pueda olvidar. Si este emit se pierde, el
   * servidor cree que no se está mirando nada y notifica de más — el lado seguro.
   */
  const setActiveConversation = useCallback((conversationId: string | null) => {
    activeRef.current = conversationId;
    socketRef.current?.emit('conversation:active', { conversationId });
  }, []);

  return { joinConversation, setActiveConversation };
}
