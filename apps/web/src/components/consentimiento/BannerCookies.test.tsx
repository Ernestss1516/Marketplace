/**
 * COOKIES RÁFAGA 2 — EL BANNER.
 *
 * Lo que más se incumple de un banner de cookies no es la mecánica: es que rechazar sea
 * más difícil que aceptar. Por eso el caso central de este fichero compara los DOS
 * botones entre sí (misma etiqueta de rol, mismas clases) en vez de limitarse a
 * comprobar que el de rechazar existe — existir, existen casi todos; lo que la AEPD
 * sanciona es que uno pese más que el otro.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { BannerCookies } from './BannerCookies';
import { CONSENT_REOPEN_EVENT } from './consentimiento';
import { NOMBRE_COOKIE, ATRIBUTO_VERSION } from '@/lib/consentimiento/constantes';
import type { CookieTextConfig } from '@/lib/api/cookies-config';

jest.mock('@/lib/api/consentimiento', () => ({
  registrarConsentimiento: jest.fn().mockResolvedValue('rec_1'),
}));

jest.mock('next/link', () => {
  // El resto de props se pasan tal cual (`data-testid`, `className`): un mock que las
  // descarta hace fallar el test por el mock y no por el componente.
  return function MockLink({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

const CONFIG: CookieTextConfig = {
  title: 'Cookies y contenido de terceros',
  body: 'Un mensaje de prueba sobre cookies.',
  acceptLabel: 'Aceptar',
  rejectLabel: 'Rechazar',
  moreLabel: 'Más información',
  policyUrl: '',
  version: '1',
};

function limpiar() {
  document.cookie = `${NOMBRE_COOKIE}=; Max-Age=0; Path=/`;
  document.body.setAttribute(ATRIBUTO_VERSION, '1');
}

beforeEach(() => {
  limpiar();
  jest.clearAllMocks();
});

describe('cuándo aparece', () => {
  it('sin cookie: aparece, con el texto configurado', () => {
    render(<BannerCookies config={CONFIG} />);
    expect(screen.getByTestId('banner-cookies')).toBeInTheDocument();
    expect(screen.getByText('Cookies y contenido de terceros')).toBeInTheDocument();
    expect(screen.getByText('Un mensaje de prueba sobre cookies.')).toBeInTheDocument();
  });

  it('tras ACEPTAR no reaparece', () => {
    const { unmount } = render(<BannerCookies config={CONFIG} />);
    fireEvent.click(screen.getByTestId('banner-cookies-aceptar'));
    unmount();

    render(<BannerCookies config={CONFIG} />);
    expect(screen.queryByTestId('banner-cookies')).not.toBeInTheDocument();
  });

  it('tras RECHAZAR tampoco reaparece — insistir a quien dijo que no es presionar', () => {
    const { unmount } = render(<BannerCookies config={CONFIG} />);
    fireEvent.click(screen.getByTestId('banner-cookies-rechazar'));
    unmount();

    // Sin esto, «rechazó» sería indistinguible de «no ha decidido» y se le preguntaría en
    // cada visita hasta que aceptara por cansancio. Es el patrón oscuro más común.
    render(<BannerCookies config={CONFIG} />);
    expect(screen.queryByTestId('banner-cookies')).not.toBeInTheDocument();
  });

  it('si el admin SUBE LA VERSIÓN, vuelve a aparecer (D5)', () => {
    const { unmount } = render(<BannerCookies config={CONFIG} />);
    fireEvent.click(screen.getByTestId('banner-cookies-aceptar'));
    unmount();

    // El admin publica un texto nuevo: el consentimiento anterior no cubre lo que dice.
    document.body.setAttribute(ATRIBUTO_VERSION, '2');
    render(<BannerCookies config={{ ...CONFIG, version: '2' }} />);
    expect(screen.getByTestId('banner-cookies')).toBeInTheDocument();
  });
});

describe('BARRERA — las tres opciones, al mismo nivel', () => {
  it('las tres son botones reales y alcanzables por teclado', () => {
    render(<BannerCookies config={CONFIG} />);
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Más información' })).toBeInTheDocument();
  });

  it('aceptar y rechazar tienen EXACTAMENTE las mismas clases', () => {
    render(<BannerCookies config={CONFIG} />);
    const aceptar = screen.getByTestId('banner-cookies-aceptar');
    const rechazar = screen.getByTestId('banner-cookies-rechazar');

    // La trampa clásica es «Aceptar» en primario sólido y «Rechazar» como enlace gris en
    // una esquina. Comparar las clases es la forma barata de que eso no pueda colarse en
    // un retoque de estilo sin que nadie lo note.
    expect(rechazar.className).toBe(aceptar.className);
  });

  it('rechazar no está escondido tras «más información»', () => {
    render(<BannerCookies config={CONFIG} />);
    // Visible en el primer nivel, sin desplegar nada: si hubiera que abrir un panel para
    // rechazar, rechazar costaría un clic más que aceptar.
    expect(screen.getByTestId('banner-cookies-rechazar')).toBeVisible();
  });
});

describe('«más información»', () => {
  it('despliega el detalle con las categorías REALES y ninguna más', () => {
    render(<BannerCookies config={CONFIG} />);
    fireEvent.click(screen.getByTestId('banner-cookies-mas'));

    const detalle = screen.getByTestId('banner-cookies-detalle');
    expect(detalle).toHaveTextContent(/Esenciales/);
    expect(detalle).toHaveTextContent(/Contenido de terceros/);
    // Un banner que ofreciera apagar «marketing» donde no hay marketing le haría creer al
    // usuario que se le sigue. No hay un solo tercero publicitario en esta plataforma.
    expect(detalle).not.toHaveTextContent(/[Mm]arketing/);
    expect(detalle).not.toHaveTextContent(/[Aa]nal[íi]tic/);
  });

  it('sin política publicada NO enlaza a ninguna parte (ráfaga 3)', () => {
    render(<BannerCookies config={CONFIG} />);
    fireEvent.click(screen.getByTestId('banner-cookies-mas'));
    // Enlazar a una ruta que no existe desde el banner legal sería peor que no enlazar.
    expect(screen.queryByTestId('banner-cookies-politica')).not.toBeInTheDocument();
  });

  it('con política publicada, enlaza a ella', () => {
    render(<BannerCookies config={{ ...CONFIG, policyUrl: '/paginas/cookies' }} />);
    fireEvent.click(screen.getByTestId('banner-cookies-mas'));
    expect(screen.getByTestId('banner-cookies-politica')).toHaveAttribute(
      'href',
      '/paginas/cookies',
    );
  });

  it('anuncia su estado a los lectores de pantalla', () => {
    render(<BannerCookies config={CONFIG} />);
    const boton = screen.getByTestId('banner-cookies-mas');
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'true');
  });

  it('su `aria-controls` apunta a un elemento QUE EXISTE', () => {
    // No es quisquillosería: `aria-controls` sólo entiende de `id`. Apuntando a un
    // `data-testid` —que es lo que hacía— el atributo parecía puesto y no servía para
    // nada: el lector de pantalla no encuentra el panel y la relación entre el botón y
    // lo que despliega se pierde. Un fallo así no se ve mirando la pantalla.
    render(<BannerCookies config={CONFIG} />);
    fireEvent.click(screen.getByTestId('banner-cookies-mas'));

    const destino = screen.getByTestId('banner-cookies-mas').getAttribute('aria-controls');
    expect(destino).toBeTruthy();
    expect(document.getElementById(destino!)).not.toBeNull();
  });
});

describe('accesibilidad', () => {
  it('es una región, NO un diálogo modal', () => {
    render(<BannerCookies config={CONFIG} />);
    const banner = screen.getByTestId('banner-cookies');
    // Un `alertdialog` declara que hay que atenderlo antes de seguir: atrapa el foco y
    // deja el contenido inaccesible. Con el gate reteniendo por defecto, el muro no
    // aporta nada y sólo presiona a aceptar (D-nueva-2).
    expect(banner).toHaveAttribute('role', 'region');
    expect(banner).toHaveAttribute('aria-label');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('reabrir desde el footer', () => {
  it('vuelve a salir, ya decidido, con el detalle abierto y el estado actual', () => {
    const { unmount } = render(<BannerCookies config={CONFIG} />);
    fireEvent.click(screen.getByTestId('banner-cookies-aceptar'));
    unmount();

    render(<BannerCookies config={CONFIG} />);
    expect(screen.queryByTestId('banner-cookies')).not.toBeInTheDocument();

    fireEvent(window, new Event(CONSENT_REOPEN_EVENT));

    expect(screen.getByTestId('banner-cookies')).toBeInTheDocument();
    // Quien viene a cambiar su decisión tiene que ver cuál es ahora mismo.
    expect(screen.getByTestId('banner-cookies-detalle')).toHaveTextContent(
      /contenido de terceros permitido/,
    );
  });

  it('permite RETIRAR un consentimiento dado (RGPD: retirar tan fácil como dar)', () => {
    const { unmount } = render(<BannerCookies config={CONFIG} />);
    fireEvent.click(screen.getByTestId('banner-cookies-aceptar'));
    expect(decodeURIComponent(document.cookie)).toContain('terceros');
    unmount();

    render(<BannerCookies config={CONFIG} />);
    fireEvent(window, new Event(CONSENT_REOPEN_EVENT));
    fireEvent.click(screen.getByTestId('banner-cookies-rechazar'));

    expect(decodeURIComponent(document.cookie)).not.toContain('terceros');
  });
});
