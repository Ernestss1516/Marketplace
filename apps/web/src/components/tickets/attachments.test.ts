import {
  ADJUNTOS_MAX_BYTES,
  ADJUNTOS_MAX_POR_MENSAJE,
  formatBytes,
  toAdjuntoMessage,
  validarAdjuntos,
} from './attachments';

/**
 * R5 — la validación de CLIENTE de los adjuntos.
 *
 * Se prueba aquí y no por navegador porque es una función pura, igual que
 * `staff-actions`. Lo que NO prueba esta suite —y no puede— es que el usuario no
 * pueda subir un fichero prohibido: eso lo garantiza el backend con un 422, y se
 * ejerce en `tickets-attachments.e2e-spec.ts`. Aquí solo se comprueba que la UI
 * ofrece lo mismo que el servidor acepta, para que las dos no discrepen.
 */
function file(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type });
  // `size` de un File es de solo lectura y deriva del contenido: se sobrescribe
  // en vez de fabricar 10 MB de relleno en memoria por test.
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

const png = (name = 'a.png', size = 1024) => file(name, 'image/png', size);

describe('validarAdjuntos', () => {
  it('sin ficheros no hay nada que objetar', () => {
    expect(validarAdjuntos([])).toBeNull();
  });

  it('acepta los cuatro tipos de §14.7 y solo esos', () => {
    expect(validarAdjuntos([png()])).toBeNull();
    expect(validarAdjuntos([file('a.jpg', 'image/jpeg', 10)])).toBeNull();
    expect(validarAdjuntos([file('a.webp', 'image/webp', 10)])).toBeNull();
    expect(validarAdjuntos([file('a.pdf', 'application/pdf', 10)])).toBeNull();

    expect(validarAdjuntos([file('a.txt', 'text/plain', 10)])).toContain('no es un tipo admitido');
    // Un .svg es una imagen que ejecuta scripts: fuera, igual que en el backend.
    expect(validarAdjuntos([file('a.svg', 'image/svg+xml', 10)])).toContain('no es un tipo admitido');
    expect(validarAdjuntos([file('a.zip', 'application/zip', 10)])).toContain('no es un tipo admitido');
  });

  it('el límite de tamaño es INCLUSIVO: 10 MB justos pasan, un byte más no', () => {
    expect(validarAdjuntos([png('justo.png', ADJUNTOS_MAX_BYTES)])).toBeNull();
    expect(validarAdjuntos([png('pasado.png', ADJUNTOS_MAX_BYTES + 1)])).toContain(
      'ocupa demasiado',
    );
  });

  it('el límite de cantidad también es inclusivo: 5 pasan, 6 no', () => {
    const cinco = Array.from({ length: ADJUNTOS_MAX_POR_MENSAJE }, (_, i) => png(`f${i}.png`));
    expect(validarAdjuntos(cinco)).toBeNull();
    expect(validarAdjuntos([...cinco, png('sexto.png')])).toContain('como máximo');
  });

  it('nombra el fichero que falla, para que el usuario sepa cuál quitar', () => {
    const motivo = validarAdjuntos([png('bueno.png'), file('malo.txt', 'text/plain', 10)]);
    expect(motivo).toContain('malo.txt');
    expect(motivo).not.toContain('bueno.png');
  });
});

describe('toAdjuntoMessage', () => {
  it('traduce los tres códigos del backend', () => {
    expect(toAdjuntoMessage('TOO_MANY_ATTACHMENTS')).toContain('como máximo');
    expect(toAdjuntoMessage('ATTACHMENT_TYPE_NOT_ALLOWED')).toContain('PDF');
    expect(toAdjuntoMessage('ATTACHMENT_TOO_LARGE')).toContain('10.0 MB');
  });

  it('devuelve null para lo que no es un error de adjunto (lo traduce quien llama)', () => {
    expect(toAdjuntoMessage('REOPEN_WINDOW_EXPIRED')).toBeNull();
    expect(toAdjuntoMessage(undefined)).toBeNull();
  });
});

describe('formatBytes', () => {
  it('escala a B, KB y MB', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
