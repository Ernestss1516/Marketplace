'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { TicketMessage } from '@/types';

export interface TicketMessagePayload {
  ticketId: string;
  message: TicketMessage;
}

interface Options {
  token: string | undefined;
  /** Hilo al que suscribirse. Sin él solo se escucha la sala personal / de staff. */
  ticketId?: string;
  onMessage: (payload: TicketMessagePayload) => void;
}

/**
 * R9 — tiempo real del hilo de ticket. Molde exacto de `useMessagingSocket`:
 * mismo namespace `/ws`, mismo token en el handshake, misma re-suscripción en
 * `connect` (que se dispara también en cada RECONEXIÓN, no solo la primera vez).
 *
 * `onMessage` se guarda en una ref y NO está en las dependencias del efecto: si
 * lo estuviera, cada render con un callback nuevo tiraría la conexión y la
 * volvería a abrir. Es el mismo cuidado que ya tenía el hook de mensajería.
 *
 * El `ticketId` sí es dependencia: cambiar de hilo tiene que cambiar de sala. Con
 * una sola sala por página no hace falta el registro de salas acumuladas que sí
 * necesita mensajería (allí se abren varias conversaciones en la misma sesión).
 */
export function useTicketSocket({ token, ticketId, onMessage }: Options): void {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!token) return;

    const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3001';
    const socket: Socket = io(`${WS_URL}/ws`, {
      auth: { token },
      transports: ['websocket'],
    });

    const join = () => {
      // El servidor verifica el acceso ANTES de unir (ticket:join): esto es una
      // petición, no una concesión. Si el hilo no es suyo, el gateway responde
      // 'error' y no une a nada — la UI no tiene que impedirlo, igual que en el
      // resto del sistema (la UI restringe, el backend garantiza).
      if (ticketId) socket.emit('ticket:join', { ticketId });
    };

    socket.on('connect', join);
    socket.on('ticket:message', (payload: TicketMessagePayload) => {
      onMessageRef.current(payload);
    });

    return () => {
      socket.disconnect();
    };
  }, [token, ticketId]);
}
