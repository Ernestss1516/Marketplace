import * as fs from 'fs';
import * as path from 'path';
import { render, screen } from '@testing-library/react';
import colors from 'tailwindcss/colors';
import resolveConfig from 'tailwindcss/resolveConfig';
import tailwindConfig from '../../../tailwind.config';
import { Aviso } from './Aviso';
import { SesionNoDisponible } from '@/app/(admin)/components/SesionNoDisponible';

/**
 * E0 — LA BARRERA DEL AVISO.
 *
 * El criterio de aceptación de toda la fase segura es que **Modelo 0 se vea idéntico al
 * estado actual**. Para casi todas las pantallas eso lo vigilan las capturas de
 * `e2e-snapshots/`. Para el aviso de sesión, no: sólo se pinta cuando la sesión existe
 * pero no trae `accessToken`, y a ese estado no se llega navegando —el middleware manda al
 * login antes de que la pantalla se monte—. Ninguna captura lo contiene.
 *
 * Así que su barrera es de otro tipo, y resulta ser MÁS ESTRECHA que un píxel: en lugar de
 * comparar imágenes, se comprueba que la migración a tokens no cambió ningún valor.
 *
 * La mutación que estos tres tests matan: tocar un color del aviso «ya que estamos». El
 * tercero es el importante — compara los tokens contra la paleta REAL de Tailwind, no
 * contra hexadecimales copiados aquí, así que también salta si una subida de Tailwind
 * cambiara el amarillo bajo nuestros pies.
 */

/** La cadena EXACTA que estaba escrita 29 veces, con los colores en clases de escala. */
const FORMA_ORIGINAL = 'rounded border border-yellow-300 bg-yellow-50 p-4 text-yellow-800';

/** La misma forma tras E0: misma geometría, colores por token. */
const FORMA_EN_TOKENS =
  'rounded border border-warning-border bg-warning p-4 text-warning-foreground';

describe('Aviso — la consolidación de las 29 copias', () => {
  it('conserva la geometría original y sólo cambia los colores por sus tokens', () => {
    render(<Aviso>hola</Aviso>);
    const caja = screen.getByText('hola');

    expect(caja.className).toBe(FORMA_EN_TOKENS);

    // Lo que se afirma de verdad: geometría IDÉNTICA. Se comparan las dos cadenas
    // quitando las clases de color de cada una; lo que queda tiene que ser lo mismo.
    const soloGeometria = (clases: string) =>
      clases
        .split(' ')
        .filter((c) => !/(yellow|warning)/.test(c))
        .join(' ');

    expect(soloGeometria(FORMA_EN_TOKENS)).toBe(soloGeometria(FORMA_ORIGINAL));
  });

  it('no añade semántica que las 29 copias no tenían', () => {
    render(<Aviso>hola</Aviso>);
    const caja = screen.getByText('hola');

    // Las 29 copias eran un `<div>` pelado. Añadir `role="alert"` sería una mejora, pero
    // cambiaría el árbol de accesibilidad — y E0 no cambia nada. Ver el doc-comment.
    expect(caja.tagName).toBe('DIV');
    expect(caja).not.toHaveAttribute('role');
  });
});

describe('SesionNoDisponible — el texto, también una sola vez', () => {
  it('dice exactamente lo que decían las 29 copias', () => {
    render(<SesionNoDisponible />);
    expect(
      screen.getByText('Sesión no disponible. Recarga la página o inicia sesión de nuevo.'),
    ).toBeInTheDocument();
  });
});

describe('Tailwind conecta las clases del aviso con sus variables', () => {
  /**
   * El eslabón que las otras pruebas no cubren. Que el componente escriba
   * `bg-warning` y que `--warning` valga el amarillo correcto no sirve de nada si la
   * configuración de Tailwind no une las dos cosas: la clase no existiría, el fondo
   * saldría transparente y las 29 pantallas cambiarían de aspecto **sin que ningún
   * test se pusiera rojo**. Aquí se comprueba el puente.
   */
  const colores = resolveConfig(tailwindConfig).theme.colors as unknown as Record<
    string,
    unknown
  >;

  it.each([
    ['DEFAULT', '--warning'],
    ['border', '--warning-border'],
    ['foreground', '--warning-foreground'],
  ])('warning.%s apunta a var(%s)', (clave, variable) => {
    expect((colores.warning as Record<string, string>)[clave]).toBe(`var(${variable})`);
  });
});

describe('Los tokens de aviso valen lo mismo que las clases que sustituyen', () => {
  const globals = fs.readFileSync(
    path.join(__dirname, '..', '..', 'app', 'globals.css'),
    'utf8',
  );

  const valorDe = (token: string): string | null => {
    const m = globals.match(new RegExp(`--${token}:\\s*([^;]+);`));
    return m ? m[1].trim() : null;
  };

  it.each([
    ['warning', colors.yellow[50], 'bg-yellow-50'],
    ['warning-border', colors.yellow[300], 'border-yellow-300'],
    ['warning-foreground', colors.yellow[800], 'text-yellow-800'],
  ])('--%s es exactamente %s, el color que daba %s', (token, esperado, _clase) => {
    expect(valorDe(token)).toBe(esperado);
  });
});
