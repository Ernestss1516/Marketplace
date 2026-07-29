// Atención al usuario R6 — QUÉ ACCIONES OFRECE la UI según el estado y el
// origen del ticket (matriz §7.2).
//
// Es la única lógica de decisión real del frontend de R6: el resto es pintar lo
// que devuelve la API. Y es la que más barato se rompe — basta con tocar una
// condición para empezar a ofrecer un botón que el backend rechazará con 403 o
// 400, que es justo lo que el principio "la UI restringe, el backend garantiza"
// pretende evitar. Un e2e de navegador cubriría lo mismo, pero una matriz de
// 5 estados × 3 orígenes en Playwright es lenta; aquí es instantánea.

import { render, screen } from '@testing-library/react';
import { TicketThreadClient } from './TicketThreadClient';
import type { TicketDetail, TicketOrigin, TicketStatus } from '@/types';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
// `next-auth/react` se publica como ESM y jest no lo transforma; llega aquí de
// rebote por useApiAction (que importa signOut para el manejo de sesión stale).
// Se mockea la dependencia, no el componente: lo que se prueba sigue siendo el
// TicketThreadClient real.
jest.mock('next-auth/react', () => ({ signOut: jest.fn() }));

const DIA = 24 * 60 * 60 * 1000;

function buildTicket(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: 'tk-1',
    subject: 'Asunto de prueba',
    status: 'OPEN',
    origin: 'USER',
    topic: null,
    linkedLabel: null,
    listingId: null,
    reviewId: null,
    invoiceId: null,
    listing: null,
    review: null,
    invoice: null,
    lastMessageAt: new Date().toISOString(),
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date().toISOString(),
    messages: [],
    nextCursor: null,
    ...overrides,
  };
}

function renderThread(overrides: Partial<TicketDetail> = {}) {
  return render(<TicketThreadClient initialData={buildTicket(overrides)} token="t" />);
}

describe('TicketThreadClient — caja de respuesta según el estado', () => {
  it.each<TicketStatus>(['OPEN', 'IN_PROGRESS', 'WAITING_USER'])(
    'en %s ofrece responder',
    (status) => {
      renderThread({ status });
      expect(screen.getByTestId('form-respuesta')).toBeInTheDocument();
      expect(screen.queryByTestId('ticket-cerrado')).not.toBeInTheDocument();
    },
  );

  it('en CLOSED NO ofrece responder, y ofrece abrir uno nuevo', () => {
    renderThread({ status: 'CLOSED', closedAt: new Date().toISOString() });

    expect(screen.queryByTestId('form-respuesta')).not.toBeInTheDocument();
    expect(screen.getByTestId('ticket-cerrado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir un ticket nuevo' })).toHaveAttribute(
      'href',
      '/mis-tickets/nuevo',
    );
  });
});

describe('TicketThreadClient — ventana de reapertura de 14 días (T8)', () => {
  it('RESOLVED DENTRO de la ventana: responder reabre, y el botón lo dice', () => {
    renderThread({ status: 'RESOLVED', resolvedAt: new Date(Date.now() - 3 * DIA).toISOString() });

    expect(screen.getByTestId('form-respuesta')).toBeInTheDocument();
    expect(screen.getByTestId('enviar-respuesta')).toHaveTextContent('Reabrir y responder');
  });

  it('RESOLVED FUERA de la ventana: sin caja, con el aviso de plazo terminado', () => {
    renderThread({ status: 'RESOLVED', resolvedAt: new Date(Date.now() - 15 * DIA).toISOString() });

    expect(screen.queryByTestId('form-respuesta')).not.toBeInTheDocument();
    expect(screen.getByTestId('ticket-cerrado')).toHaveTextContent('plazo para reabrir');
  });

  it('justo en el límite (13 días) todavía se puede reabrir', () => {
    renderThread({ status: 'RESOLVED', resolvedAt: new Date(Date.now() - 13 * DIA).toISOString() });
    expect(screen.getByTestId('form-respuesta')).toBeInTheDocument();
  });

  it('RESOLVED sin resolvedAt se trata como fuera de ventana (dato incoherente → opción segura)', () => {
    renderThread({ status: 'RESOLVED', resolvedAt: null });
    expect(screen.queryByTestId('form-respuesta')).not.toBeInTheDocument();
  });
});

describe('TicketThreadClient — «ya no lo necesito» (T11) solo en hilos propios', () => {
  it('origin=USER y vivo: ofrece cerrar', () => {
    renderThread({ origin: 'USER', status: 'OPEN' });
    expect(screen.getByTestId('cerrar-ticket')).toBeInTheDocument();
  });

  // El backend responde 403 en estos dos casos: la UI ni siquiera lo ofrece.
  it.each<TicketOrigin>(['ADMIN', 'REPORT'])(
    'origin=%s: NO ofrece cerrar (lo inició la administración)',
    (origin) => {
      renderThread({ origin, status: 'WAITING_USER' });
      expect(screen.queryByTestId('cerrar-ticket')).not.toBeInTheDocument();
      // Pero sí puede responder: el hilo sigue vivo.
      expect(screen.getByTestId('form-respuesta')).toBeInTheDocument();
    },
  );

  it('origin=USER pero ya CLOSED: no ofrece cerrar dos veces', () => {
    renderThread({ origin: 'USER', status: 'CLOSED' });
    expect(screen.queryByTestId('cerrar-ticket')).not.toBeInTheDocument();
  });
});

describe('TicketThreadClient — el hilo', () => {
  it('pinta cada mensaje en su lado, congelado por `side` (no por quién sea el autor)', () => {
    renderThread({
      messages: [
        {
          id: 'm2',
          ticketId: 'tk-1',
          authorId: 'staff',
          side: 'STAFF',
          body: 'Respuesta del soporte',
          internal: false,
          readByUserAt: null,
          readByStaffAt: null,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'm1',
          ticketId: 'tk-1',
          authorId: 'user',
          side: 'USER',
          body: 'Mi pregunta',
          internal: false,
          readByUserAt: null,
          readByStaffAt: null,
          createdAt: new Date(Date.now() - 1000).toISOString(),
        },
      ],
    });

    expect(screen.getByTestId('mensaje-staff')).toHaveTextContent('Respuesta del soporte');
    expect(screen.getByTestId('mensaje-user')).toHaveTextContent('Mi pregunta');
  });

  it('sin cursor no ofrece «cargar mensajes anteriores»', () => {
    renderThread({ nextCursor: null });
    expect(screen.queryByRole('button', { name: /mensajes anteriores/i })).not.toBeInTheDocument();
  });

  it('con cursor sí lo ofrece', () => {
    renderThread({ nextCursor: 'm-viejo' });
    expect(screen.getByRole('button', { name: /mensajes anteriores/i })).toBeInTheDocument();
  });
});
