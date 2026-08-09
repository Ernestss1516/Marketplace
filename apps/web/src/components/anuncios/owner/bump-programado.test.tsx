/**
 * Bump automático — lo que el propietario VE de su programación.
 *
 * Se prueba aquí y no en Playwright porque los estados que importan —pausada por falta de
 * saldo, pausada porque el anuncio dejó de estar activo— los produce el scheduler, y
 * fabricarlos desde el navegador exigiría agotar el saldo de verdad. El componente sí acepta
 * el estado por props.
 *
 * LO QUE FIJA: que una pausa se VEA y diga POR QUÉ. Si una programación parada se pintara
 * igual que una activa —o no se pintara— el usuario creería que sus bumps siguen corriendo.
 * Es el mismo defecto que UXV.6/M12 cerró con la cuota Pro: al agotarse desaparecía, y «no
 * la tengo» se veía idéntico a «ya la gasté».
 */
import { render, screen, cleanup } from '@testing-library/react';
import { PromotionStatus } from './PromotionStatus';
import { estadoProgramacion, type BumpScheduleSummary } from '@/lib/api/bump-schedules';

const programacion = (over: Partial<BumpScheduleSummary> = {}): BumpScheduleSummary => ({
  id: 's1',
  status: 'ACTIVE',
  nextRunAt: '2026-09-01T07:00:00.000Z',
  intervalDays: 3,
  hourOfDay: 9,
  ...over,
});

afterEach(cleanup);

describe('PromotionStatus — la línea del bump programado', () => {
  it('activa: dice cuándo es el próximo, en hora peninsular y dicho', () => {
    render(<PromotionStatus bumpSchedule={programacion()} />);

    const linea = screen.getByTestId('estado-bump-programado');
    expect(linea).toHaveTextContent(/próximo bump/i);
    // La zona se declara: a alguien que abra desde fuera de España el navegador le pintaría
    // otra hora distinta de la que el sistema va a usar.
    expect(linea).toHaveTextContent(/hora peninsular/i);
  });

  it('pausada SIN SALDO: se ve, dice por qué, y ofrece la salida', () => {
    render(<PromotionStatus bumpSchedule={programacion({ status: 'PAUSED_NO_FUNDS' })} />);

    const linea = screen.getByTestId('estado-bump-programado');
    expect(linea).toHaveTextContent(/pausa/i);
    expect(linea).toHaveTextContent(/sin saldo/i);
    // Un «pausado» a secas es un callejón: hay que poder salir de él desde aquí.
    expect(screen.getByRole('link', { name: /recargar/i })).toHaveAttribute('href', '/mis-creditos');
  });

  it('pausada por ANUNCIO INACTIVO: otra razón, y no ofrece recargar (no serviría)', () => {
    render(<PromotionStatus bumpSchedule={programacion({ status: 'PAUSED_LISTING_INACTIVE' })} />);

    const linea = screen.getByTestId('estado-bump-programado');
    expect(linea).toHaveTextContent(/no está activo/i);
    expect(screen.queryByRole('link', { name: /recargar/i })).not.toBeInTheDocument();
  });

  it('pausada por el usuario: se ve, sin dramatizar', () => {
    render(<PromotionStatus bumpSchedule={programacion({ status: 'PAUSED_BY_USER' })} />);
    expect(screen.getByTestId('estado-bump-programado')).toHaveTextContent(/pausa/i);
  });

  it('sin programación no se pinta nada: un anuncio normal no carga con un hueco vacío', () => {
    render(<PromotionStatus />);
    expect(screen.queryByTestId('estado-promocion')).not.toBeInTheDocument();
  });

  it('REQUISITO DE ORO — «Destacado hasta» sigue igual, y ahora conviven', () => {
    render(
      <PromotionStatus
        featuredUntil="2026-09-20T00:00:00.000Z"
        bumpSchedule={programacion()}
      />,
    );

    // Lo que UXV.4 ya mostraba no se pierde al añadir la línea nueva.
    expect(screen.getByTestId('estado-promocion')).toHaveTextContent(/destacado hasta/i);
    expect(screen.getByTestId('estado-bump-programado')).toBeInTheDocument();
  });
});

describe('estadoProgramacion — la razón decide la salida', () => {
  it('cada pausa tiene su texto, y solo la de saldo tiene acción', () => {
    expect(estadoProgramacion({ status: 'ACTIVE', nextRunAt: '2026-09-01T07:00:00.000Z' }).activa).toBe(true);

    const sinSaldo = estadoProgramacion({ status: 'PAUSED_NO_FUNDS', nextRunAt: '2026-09-01T07:00:00.000Z' });
    expect(sinSaldo.activa).toBe(false);
    expect(sinSaldo.accion?.href).toBe('/mis-creditos');

    // Ofrecer «recargar» aquí sería mandar al usuario a gastar dinero en algo que no
    // arregla su problema: lo que hay que hacer es reactivar el anuncio.
    const inactivo = estadoProgramacion({ status: 'PAUSED_LISTING_INACTIVE', nextRunAt: '2026-09-01T07:00:00.000Z' });
    expect(inactivo.accion).toBeNull();
  });
});
