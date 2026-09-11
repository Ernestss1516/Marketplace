/**
 * COOKIES RÁFAGA 3 — EL PANEL DE PREFERENCIAS DE LA PÁGINA DE COOKIES.
 *
 * Lo que importa aquí no es que los botones existan, sino que el panel **diga el estado
 * actual antes de ofrecer cambiarlo**: «retirar el consentimiento» sin decir si lo hay es
 * un botón a ciegas, y quien está leyendo la política es justo quien necesita saber en
 * qué situación está.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { CookiePreferencesBlockRenderer } from './CookiePreferencesBlockRenderer';
import { NOMBRE_COOKIE, ATRIBUTO_VERSION } from '@/lib/consentimiento/constantes';

jest.mock('@/lib/api/consentimiento', () => ({
  registrarConsentimiento: jest.fn().mockResolvedValue('rec_1'),
}));

function cookieCon(categorias: string[]) {
  const valor = { v: '1', c: categorias, t: 1_757_548_800, id: 'rec_1' };
  document.cookie = `${NOMBRE_COOKIE}=${encodeURIComponent(JSON.stringify(valor))}; Path=/`;
}

beforeEach(() => {
  document.cookie = `${NOMBRE_COOKIE}=; Max-Age=0; Path=/`;
  document.body.setAttribute(ATRIBUTO_VERSION, '1');
  jest.clearAllMocks();
});

describe('dice el estado antes de ofrecer cambiarlo', () => {
  it('sin decidir: no permitido, y LAS DOS acciones disponibles', () => {
    render(<CookiePreferencesBlockRenderer />);

    expect(screen.getByTestId('panel-preferencias-estado')).toHaveTextContent(/No permitido/);
    expect(screen.getByTestId('panel-preferencias-permitir')).toBeEnabled();
    // «Retirar» sigue activo aunque no haya nada que retirar, y es deliberado: equivale a
    // rechazar, que es una decisión válida y útil —queda registrada y el banner deja de
    // salir—. Quien llega aquí desde el banner sin haber decidido puede resolverlo en la
    // propia política, sin volver atrás.
    expect(screen.getByTestId('panel-preferencias-retirar')).toBeEnabled();
  });

  it('habiendo rechazado ya, «retirar» se apaga: no hay nada que retirar', () => {
    cookieCon([]);
    render(<CookiePreferencesBlockRenderer />);
    expect(screen.getByTestId('panel-preferencias-retirar')).toBeDisabled();
  });

  it('habiendo aceptado: permitido, y se puede retirar', () => {
    cookieCon(['terceros']);
    render(<CookiePreferencesBlockRenderer />);

    expect(screen.getByTestId('panel-preferencias-estado')).toHaveTextContent(/Permitido/);
    expect(screen.getByTestId('panel-preferencias-retirar')).toBeEnabled();
    expect(screen.getByTestId('panel-preferencias-permitir')).toBeDisabled();
  });

  it('habiendo rechazado: no permitido, y se puede permitir', () => {
    cookieCon([]);
    render(<CookiePreferencesBlockRenderer />);

    expect(screen.getByTestId('panel-preferencias-estado')).toHaveTextContent(/No permitido/);
    expect(screen.getByTestId('panel-preferencias-permitir')).toBeEnabled();
  });
});

describe('cambia de verdad la decisión', () => {
  it('permitir escribe la cookie', () => {
    render(<CookiePreferencesBlockRenderer />);
    fireEvent.click(screen.getByTestId('panel-preferencias-permitir'));

    expect(decodeURIComponent(document.cookie)).toContain('terceros');
    expect(screen.getByTestId('panel-preferencias-estado')).toHaveTextContent(/Permitido/);
  });

  it('retirar la deja sin categorías — RGPD: retirar tan fácil como dar', () => {
    cookieCon(['terceros']);
    render(<CookiePreferencesBlockRenderer />);

    fireEvent.click(screen.getByTestId('panel-preferencias-retirar'));

    expect(decodeURIComponent(document.cookie)).not.toContain('terceros');
    expect(screen.getByTestId('panel-preferencias-estado')).toHaveTextContent(/No permitido/);
  });

  it('los dos botones pesan lo mismo', () => {
    // Misma trampa que en el banner: si retirar costara más que permitir, el panel
    // empujaría en una dirección. Se comparan las clases.
    render(<CookiePreferencesBlockRenderer />);
    const permitir = screen.getByTestId('panel-preferencias-permitir');
    const retirar = screen.getByTestId('panel-preferencias-retirar');
    expect(retirar.className).toBe(permitir.className);
  });
});

describe('no promete lo que no puede cumplir', () => {
  it('avisa de que lo ya cargado sigue ahí hasta recargar', () => {
    // Un iframe montado ya habló con el tercero, y desmontarlo no borra lo que aquél
    // guardó. Decirlo es lo honesto; prometer un borrado imposible, no.
    render(<CookiePreferencesBlockRenderer />);
    expect(screen.getByTestId('panel-preferencias-cookies')).toHaveTextContent(
      /Lo que ya se hubiera cargado en esta página seguirá ahí hasta que la recargues/,
    );
  });

  it('sólo enseña las dos categorías reales', () => {
    render(<CookiePreferencesBlockRenderer />);
    const panel = screen.getByTestId('panel-preferencias-cookies');
    expect(panel).toHaveTextContent(/Esenciales/);
    expect(panel).toHaveTextContent(/Contenido de terceros/);
    expect(panel).not.toHaveTextContent(/[Mm]arketing/);
    expect(panel).not.toHaveTextContent(/[Aa]nal[íi]tic/);
  });
});
