/**
 * COOKIES RÁFAGA 1 — EL GATE. La barrera que cierra el incumplimiento.
 *
 * Lo que se prueba aquí no es una interfaz: es que **el hijo no llega a montarse** sin
 * consentimiento. Por eso el contenido de prueba no es un `<div>` cualquiera sino un
 * componente que GRITA al montarse (`onMount`): si el gate lo renderizara oculto, o lo
 * montara para descartarlo después, este espía lo cazaría. Un iframe montado ya ha
 * hablado con el tercero, aunque nadie lo vea.
 *
 * Los gates son AUTÓNOMOS —leen la cookie por su cuenta—, así que aquí se montan sin
 * envoltorio ninguno: es exactamente como viven en las páginas.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { GateTerceros } from './GateTerceros';
import { ConsentTodoConcedido } from './consentimiento';
import { NOMBRE_COOKIE } from '@/lib/consentimiento/constantes';

jest.mock('@/lib/api/consentimiento', () => ({
  registrarConsentimiento: jest.fn().mockResolvedValue('rec_1'),
}));

/** Un tercero de mentira que avisa en cuanto se monta. */
function TerceroEspia({ onMount }: { onMount: () => void }) {
  onMount();
  return <div data-testid="tercero-montado">contenido del tercero</div>;
}

beforeEach(() => {
  document.cookie = `${NOMBRE_COOKIE}=; Max-Age=0; Path=/`;
  jest.clearAllMocks();
});

describe('sin consentimiento', () => {
  it('NO monta al tercero y pinta el marcador con su nombre', () => {
    const montado = jest.fn();
    render(
      <GateTerceros proveedor="Vimeo" descripcion="Este vídeo" testId="gate">
        <TerceroEspia onMount={montado} />
      </GateTerceros>,
    );

    // LA BARRERA: el tercero no se monta. No «se monta y se oculta».
    expect(montado).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tercero-montado')).not.toBeInTheDocument();

    // Y en su lugar hay algo que informa, no un hueco.
    expect(screen.getByTestId('gate')).toBeInTheDocument();
    expect(screen.getByText(/Este vídeo se carga desde Vimeo/)).toBeInTheDocument();
    expect(screen.getByText(/se transfiere tu dirección IP a Vimeo/)).toBeInTheDocument();
  });

  it('el marcador es operable con teclado: dos botones reales', () => {
    render(
      <GateTerceros proveedor="MapTiler" descripcion="El mapa">
        <TerceroEspia onMount={jest.fn()} />
      </GateTerceros>,
    );

    // `getByRole('button')` sólo los encuentra si son botones de verdad — un `<div>` con
    // `onClick` no es alcanzable por teclado ni lo anuncia un lector de pantalla.
    expect(screen.getByRole('button', { name: /Cargar solo esta vez/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Permitir contenido de terceros/ })).toBeInTheDocument();
  });
});

describe('«cargar solo esta vez»', () => {
  it('monta el tercero, avisa de quién es, y NO escribe cookie', () => {
    const montado = jest.fn();
    render(
      <GateTerceros proveedor="Vimeo" descripcion="Este vídeo" testId="gate">
        <TerceroEspia onMount={montado} />
      </GateTerceros>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Cargar solo esta vez/ }));

    expect(montado).toHaveBeenCalled();
    expect(screen.getByTestId('tercero-montado')).toBeInTheDocument();
    // El aviso acompaña al contenido: cargar no puede significar cargar sin informar.
    expect(screen.getByTestId('gate-aviso')).toBeInTheDocument();

    // LO QUE HACE QUE ESTA OPCIÓN EXISTA: ver un vídeo suelto no consiente todos los
    // terceros del sitio durante seis meses.
    expect(document.cookie).not.toContain(NOMBRE_COOKIE);
  });
});

describe('«permitir contenido de terceros»', () => {
  it('monta el tercero y escribe la cookie', () => {
    const montado = jest.fn();
    render(
      <GateTerceros proveedor="Vimeo" descripcion="Este vídeo">
        <TerceroEspia onMount={montado} />
      </GateTerceros>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Permitir contenido de terceros/ }));

    expect(montado).toHaveBeenCalled();
    expect(document.cookie).toContain(NOMBRE_COOKIE);
    expect(decodeURIComponent(document.cookie)).toContain('terceros');
  });

  it('registra la decisión en el servidor (la prueba del art. 7.1)', () => {
    const { registrarConsentimiento } = jest.requireMock('@/lib/api/consentimiento') as {
      registrarConsentimiento: jest.Mock;
    };

    render(
      <GateTerceros proveedor="Vimeo" descripcion="Este vídeo">
        <TerceroEspia onMount={jest.fn()} />
      </GateTerceros>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Permitir contenido de terceros/ }));

    expect(registrarConsentimiento).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'GRANTED', categories: ['terceros'] }),
    );
  });

  it('ABRE LOS DEMÁS GATES DE LA PÁGINA sin recargar', () => {
    // Dos gates independientes (un vídeo y un mapa, o dos vídeos). Sin el evento, el
    // segundo seguiría con su marcador hasta que alguien recargara — y el usuario ya
    // había dicho que sí. Es lo que sustituye al proveedor global que rompía la
    // hidratación.
    const segundo = jest.fn();
    render(
      <>
        <GateTerceros proveedor="Vimeo" descripcion="Este vídeo">
          <TerceroEspia onMount={jest.fn()} />
        </GateTerceros>
        <GateTerceros proveedor="MapTiler" descripcion="El mapa" testId="gate-2">
          <TerceroEspia onMount={segundo} />
        </GateTerceros>
      </>,
    );

    expect(segundo).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: /Permitir contenido de terceros/ })[0]);

    expect(segundo).toHaveBeenCalled();
    expect(screen.queryByTestId('gate-2')).not.toBeInTheDocument();
  });
});

describe('D3 — el contenido solicitado expresamente por el usuario', () => {
  it('carga sin consentimiento previo, PERO con el aviso permanente', () => {
    const montado = jest.fn();
    render(
      <GateTerceros proveedor="MapTiler" descripcion="El mapa" solicitadoPorUsuario testId="gate">
        <TerceroEspia onMount={montado} />
      </GateTerceros>,
    );

    expect(montado).toHaveBeenCalled();
    // SIN ESTE AVISO D3 SERÍA UNA EXENCIÓN SILENCIOSA, que es justo lo que la decisión
    // no autoriza: pedir el mapa consiente MapTiler, pero el usuario tiene que saberlo.
    expect(screen.getByTestId('gate-aviso')).toBeInTheDocument();
    expect(screen.getByText(/se sirve desde MapTiler/)).toBeInTheDocument();
  });

  it('no escribe cookie: pedir un mapa no consiente todos los terceros del sitio', () => {
    render(
      <GateTerceros proveedor="MapTiler" descripcion="El mapa" solicitadoPorUsuario>
        <TerceroEspia onMount={jest.fn()} />
      </GateTerceros>,
    );
    expect(document.cookie).not.toContain(NOMBRE_COOKIE);
  });
});

describe('en el backoffice (D-nueva-3)', () => {
  it('carga sin marcador — el editor ve el vídeo que acaba de pegar', () => {
    const montado = jest.fn();
    render(
      <ConsentTodoConcedido>
        <GateTerceros proveedor="Vimeo" descripcion="Este vídeo" testId="gate">
          <TerceroEspia onMount={montado} />
        </GateTerceros>
      </ConsentTodoConcedido>,
    );

    expect(montado).toHaveBeenCalled();
    expect(screen.queryByTestId('gate')).not.toBeInTheDocument();
    // Y sin aviso: el backoffice no es una superficie publicada.
    expect(screen.queryByTestId('gate-aviso')).not.toBeInTheDocument();
  });

  it('fuera del backoffice, por defecto, RETIENE (fail-closed)', () => {
    // El override es opt-in por zona: una zona que no dice nada retiene. El fallo tiene
    // que caer del lado seguro sin que nadie tenga que acordarse.
    const montado = jest.fn();
    render(
      <GateTerceros proveedor="Vimeo" descripcion="Este vídeo">
        <TerceroEspia onMount={montado} />
      </GateTerceros>,
    );
    expect(montado).not.toHaveBeenCalled();
  });
});
