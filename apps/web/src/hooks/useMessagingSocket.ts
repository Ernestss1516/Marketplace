'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ChatMessage } from '@/lib/api/mensajes';

export interface MessagePayload {
  conversationId: string;
  message: ChatMessage;
}

interface Options {
  token: string;
  /** If provided, emits 'conversation:join' on connect and reconnect. */
  conversationId?: string;
  onMessage: (payload: MessagePayload) => void;
}

/**
 * Connects to the messaging WebSocket namespace and calls onMessage on every
 * incoming 'message:new' event. If conversationId is given, joins that room
 * automatically on connect (and on every reconnect, since socket.io re-fires
 * the 'connect' event after a reconnection).
 */
export function useMessagingSocket({ token, conversationId, onMessage }: Options) {
  // Keep the latest callback in a ref so changing it never triggers reconnect
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3001';
    const socket: Socket = io(`${WS_URL}/ws`, {
      auth: { token },
      transports: ['websocket'],
    });

    function joinRoom() {
      if (conversationId) {
        socket.emit('conversation:join', { conversationId });
      }
    }

    // 'connect' fires on initial connect AND on every successful reconnect,
    // so conversation:join is automatically re-emitted after a disconnection.
    socket.on('connect', joinRoom);

    socket.on('message:new', (payload: MessagePayload) => {
      onMessageRef.current(payload);
    });

    return () => {
      socket.disconnect();
    };
    // Reconnect when token or conversationId changes
  }, [token, conversationId]);
}
