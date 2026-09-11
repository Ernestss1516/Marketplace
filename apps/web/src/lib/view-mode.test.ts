/**
 * COOKIES RÁFAGA 1 (D3) — «¿pidió el usuario el mapa, o le vino dado?».
 *
 * Esta distinción es la que decide si MapTiler recibe la IP de un visitante que no ha
 * pedido nada. La señal ya existía en el código —`resolveCurrentView` recibe el
 * parámetro crudo de la URL—; estos casos fijan el significado para que nadie la
 * simplifique a «¿la vista actual es MAPA?», que es precisamente el error que dejaría
 * cargar el tercero en una categoría con `defaultView = MAPA`.
 */

import { resolveCurrentView, usuarioPidioVista } from './view-mode';
import type { ListingViewMode } from '@/types';

const TODAS: ListingViewMode[] = ['LISTA', 'AMPLIADA', 'MAPA'];

describe('usuarioPidioVista', () => {
  it('con ?view=mapa: SÍ lo pidió', () => {
    expect(usuarioPidioVista('mapa', TODAS, 'MAPA')).toBe(true);
  });

  it('EL CASO QUE JUSTIFICA D3 — sin ?view, aunque la vista resuelta sea MAPA: NO lo pidió', () => {
    // Una categoría con `defaultView = MAPA` (schema.prisma:773) resuelve a MAPA sin que
    // el usuario haya tocado nada. Ahí el mapa NO puede cargar sin marcador.
    expect(resolveCurrentView(undefined, TODAS, 'MAPA')).toBe('MAPA');
    expect(usuarioPidioVista(undefined, TODAS, 'MAPA')).toBe(false);
  });

  it('pidiendo otra vista: no pidió el mapa', () => {
    expect(usuarioPidioVista('lista', TODAS, 'MAPA')).toBe(false);
  });

  it('un ?view inválido no cuenta como petición', () => {
    expect(usuarioPidioVista('mapaa', TODAS, 'MAPA')).toBe(false);
    expect(usuarioPidioVista('', TODAS, 'MAPA')).toBe(false);
  });

  it('si la categoría no permite MAPA, pedirlo no cuenta', () => {
    // `resolveCurrentView` ya caería al default; esto mantiene las dos funciones de
    // acuerdo — no puede haber «pidió una vista» que la categoría ni siquiera ofrece.
    expect(usuarioPidioVista('mapa', ['LISTA', 'AMPLIADA'], 'MAPA')).toBe(false);
  });

  it('un enlace compartido con ?view=mapa cuenta como petición', () => {
    // Abrir un enlace a un mapa es pedir un mapa. Y como es una propiedad de la URL y no
    // del visitante, es cacheable: puede viajar en el HTML estático sin romper el ISR.
    expect(usuarioPidioVista('mapa', TODAS, 'MAPA')).toBe(true);
  });
});
