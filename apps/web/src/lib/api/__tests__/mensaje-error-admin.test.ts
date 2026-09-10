import { ApiError, mensajeDeErrorAdmin } from '../client';

/**
 * E10 — EL BACKOFFICE NO PINTA TEXTO DEL SERVIDOR.
 *
 * La afirmación que sostiene toda la ráfaga es negativa —«el mensaje del servidor NO
 * aparece»— y una afirmación negativa hay que probarla con el caso que la rompería. Por
 * eso casi todos estos tests meten un secreto de mentira dentro del `message` y exigen
 * que no salga: es exactamente lo que pasaría el día que alguien interpolara un valor de
 * configuración en un `throw` del backend.
 */

const SECRETO = 're_ZjK8mQ2vBn4TpL9x';

/** Un error del servidor con algo que NUNCA debe llegar a una pantalla. */
function errorConSecreto(statusCode = 500): ApiError {
  return new ApiError(statusCode, `Resend rechazó la petición con la clave ${SECRETO}`);
}

describe('mensajeDeErrorAdmin — el texto del servidor no sale de aquí', () => {
  let espia: jest.SpyInstance;

  beforeEach(() => {
    // El helper manda el error entero a la consola a propósito; se silencia para que la
    // salida de la batería no se llene, y de paso se comprueba que va (más abajo).
    espia = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => espia.mockRestore());

  it.each([400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503])(
    'con un %i, el mensaje del servidor NO aparece',
    (statusCode) => {
      const salida = mensajeDeErrorAdmin(errorConSecreto(statusCode), 'Error al cargar');
      expect(salida).not.toContain(SECRETO);
      expect(salida).not.toContain('Resend');
      expect(salida).not.toContain('rechazó');
    },
  );

  it('lo que SÍ aparece: el contexto de quien llama y el código', () => {
    // Las dos cosas que hacían útil al molde viejo y que no necesitan texto del servidor.
    const salida = mensajeDeErrorAdmin(errorConSecreto(403), 'Error al cargar la marca');
    expect(salida).toContain('Error al cargar la marca');
    expect(salida).toContain('403');
  });

  it('el motivo se deriva del CÓDIGO, y cada familia dice lo suyo', () => {
    const m = (c: number) => mensajeDeErrorAdmin(new ApiError(c, 'da igual lo que ponga'), 'X');
    expect(m(403)).toContain('no tienes permiso');
    expect(m(404)).toContain('no se ha encontrado');
    expect(m(409)).toContain('choca con el estado actual');
    expect(m(429)).toContain('demasiadas peticiones');
    expect(m(500)).toContain('ha fallado el servidor');
    // Un 5xx que no sea 500 va por el mismo sitio: para el operador son lo mismo.
    expect(m(503)).toContain('ha fallado el servidor');
  });

  it('lo que no es un ApiError se queda en el respaldo, sin inventar nada', () => {
    // Un fallo de red, un TypeError, lo que sea: no hay código que mirar y el texto de un
    // Error de JavaScript puede llevar dentro rutas de fichero o trozos de la petición.
    expect(mensajeDeErrorAdmin(new Error(`fetch falló: ${SECRETO}`), 'Error al cargar')).toBe(
      'Error al cargar',
    );
    expect(mensajeDeErrorAdmin('una cadena suelta', 'Error al cargar')).toBe('Error al cargar');
    expect(mensajeDeErrorAdmin(undefined, 'Error al cargar')).toBe('Error al cargar');
  });

  it('LA PUERTA SÍ pasa tal cual: es el canal que el backend marca como legible', () => {
    // No es una excepción a la regla, es la regla: `reasons` sólo lo rellena
    // `construirRechazo` con texto escrito para leerse. `message`, en cambio, lo llena
    // cualquier `throw` de cualquier módulo — que es de lo que va todo esto.
    const err = new ApiError(400, 'texto interno que no debe verse', undefined, undefined, undefined, [
      { code: 'ACTIVE_LIMIT_REACHED', message: 'Has llegado a tu tope de anuncios activos.' },
    ]);
    const salida = mensajeDeErrorAdmin(err, 'Error al publicar');
    expect(salida).toBe('Has llegado a tu tope de anuncios activos.');
    expect(salida).not.toContain('texto interno');
  });

  it('el detalle completo va a la consola — el diagnóstico se conserva, fuera del DOM', () => {
    // Es lo único del molde viejo que merecía la pena, y el sitio correcto para ello: la
    // consola no acaba en una captura de pantalla ni en el `textContent` de un test.
    const err = errorConSecreto(500);
    mensajeDeErrorAdmin(err, 'Error al cargar');
    expect(espia).toHaveBeenCalledWith('[backoffice]', 'Error al cargar', err);
  });
});
