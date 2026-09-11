/**
 * COOKIES RÁFAGA 2 — EL ENLACE ANÓNIMO → LOGUEADO, DEL LADO DEL CLIENTE.
 *
 * El backend ya tiene su batería (`cookies-config.e2e-spec.ts`): escribe una fila nueva,
 * no toca la vieja y no duplica. Lo que se prueba AQUÍ es la otra mitad —que alguien
 * llame a esa puerta— y sobre todo **cuándo NO hay que llamarla**, que es casi siempre:
 * sin sesión, sin decisión previa, o con una decisión que nunca llegó a registrarse.
 *
 * Sin estos casos, el componente podría no llamar nunca y todo seguiría en verde: el
 * endpoint funcionaría perfectamente sin que nadie lo usara.
 */

import { render } from '@testing-library/react';
import { VincularConsentimiento } from './VincularConsentimiento';
import { NOMBRE_COOKIE, ATRIBUTO_VERSION } from '@/lib/consentimiento/constantes';

jest.mock('@/lib/api/consentimiento', () => ({
  vincularConsentimiento: jest.fn().mockResolvedValue(undefined),
}));

const { vincularConsentimiento } = jest.requireMock('@/lib/api/consentimiento') as {
  vincularConsentimiento: jest.Mock;
};

function ponerCookie(valor: Record<string, unknown>) {
  document.cookie = `${NOMBRE_COOKIE}=${encodeURIComponent(JSON.stringify(valor))}; Path=/`;
}

beforeEach(() => {
  document.cookie = `${NOMBRE_COOKIE}=; Max-Age=0; Path=/`;
  document.body.setAttribute(ATRIBUTO_VERSION, '1');
  jest.clearAllMocks();
});

describe('cuando SÍ hay que vincular', () => {
  it('con sesión y una decisión registrada, la ata a la cuenta', () => {
    ponerCookie({ v: '1', c: ['terceros'], t: 1_757_548_800, id: 'rec_123' });

    render(<VincularConsentimiento token="tok_abc" />);

    // El `id` de la cookie es lo único que une las dos mitades: es exactamente para lo
    // que ese campo existe desde la ráfaga 1.
    expect(vincularConsentimiento).toHaveBeenCalledWith('rec_123', 'tok_abc');
  });

  it('una sola vez por carga, aunque React vuelva a renderizar', () => {
    ponerCookie({ v: '1', c: ['terceros'], t: 1_757_548_800, id: 'rec_123' });

    const { rerender } = render(<VincularConsentimiento token="tok_abc" />);
    rerender(<VincularConsentimiento token="tok_abc" />);
    rerender(<VincularConsentimiento token="tok_abc" />);

    // El corte de verdad está en el servidor (no duplica filas), pero no tiene sentido
    // golpear la API en cada render para que allí digan que no hay nada que hacer.
    expect(vincularConsentimiento).toHaveBeenCalledTimes(1);
  });
});

describe('cuando NO hay que vincular — que es el caso normal', () => {
  it('sin sesión no llama: no hay cuenta a la que atar nada', () => {
    ponerCookie({ v: '1', c: ['terceros'], t: 1_757_548_800, id: 'rec_123' });
    render(<VincularConsentimiento />);
    expect(vincularConsentimiento).not.toHaveBeenCalled();
  });

  it('sin decisión previa no llama: todavía no hay nada que atar', () => {
    render(<VincularConsentimiento token="tok_abc" />);
    expect(vincularConsentimiento).not.toHaveBeenCalled();
  });

  it('con una decisión SIN registrar (id null) no llama', () => {
    // Pasa de verdad: el registro es fail-open, así que si la API estaba caída cuando el
    // usuario decidió, su cookie es válida pero no tiene `id`. No hay fila que vincular.
    ponerCookie({ v: '1', c: ['terceros'], t: 1_757_548_800, id: null });
    render(<VincularConsentimiento token="tok_abc" />);
    expect(vincularConsentimiento).not.toHaveBeenCalled();
  });

  it('con una cookie de OTRA versión no llama', () => {
    // El admin subió la versión: esa decisión ya no vale y el banner volverá a preguntar.
    // Atar a la cuenta un consentimiento caducado sería registrar algo que ya no rige.
    ponerCookie({ v: '0', c: ['terceros'], t: 1_757_548_800, id: 'rec_viejo' });
    render(<VincularConsentimiento token="tok_abc" />);
    expect(vincularConsentimiento).not.toHaveBeenCalled();
  });
});

describe('no pinta nada', () => {
  it('no añade un solo nodo al DOM', () => {
    ponerCookie({ v: '1', c: ['terceros'], t: 1_757_548_800, id: 'rec_123' });
    const { container } = render(<VincularConsentimiento token="tok_abc" />);
    // Vive en el layout raíz, junto al <Toaster/>: si pintara algo, saldría en todas las
    // páginas de la plataforma.
    expect(container).toBeEmptyDOMElement();
  });
});
