import { elegirAccionDeEstado } from './moderacion-routing';

/**
 * MODERACIÓN M2 — el reparto de endpoints del backoffice.
 *
 * Lo que hay que proteger no es que la página compile, sino que **aprobar y
 * rechazar dejen de irse por el endpoint genérico**. El defecto original era
 * invisible precisamente porque el genérico FUNCIONA: el anuncio cambia de
 * estado y todo parece correcto — lo único que falta es el registro y el aviso al
 * vendedor, que no se ven desde la pantalla.
 *
 * Por eso la decisión vive en una función pura y se prueba aquí: es la clase de
 * cosa que se rompe en una refactorización sin que nada falle a la vista.
 */

describe('elegirAccionDeEstado — qué endpoint usa el backoffice', () => {
  describe('saliendo de PENDING_REVIEW son ACCIONES DE MODERACIÓN', () => {
    it('→ ACTIVE es aprobar (registra y avisa)', () => {
      expect(elegirAccionDeEstado('PENDING_REVIEW', 'ACTIVE')).toBe('approve');
    });

    it('→ REJECTED es rechazar (avisa con el motivo)', () => {
      expect(elegirAccionDeEstado('PENDING_REVIEW', 'REJECTED')).toBe('reject');
    });

    it('→ DRAFT sigue siendo genérico: devolver al vendedor no es rechazar', () => {
      // Es la tercera salida de la máquina de estados y no tiene endpoint de
      // moderación propio. También es la que hace justo que aprobar pueda exigir
      // las reglas del anuncio: el moderador que se topa con un anuncio sin
      // fotos tiene por dónde salir.
      expect(elegirAccionDeEstado('PENDING_REVIEW', 'DRAFT')).toBe('generic');
    });
  });

  describe('desde cualquier otro estado NO es moderación', () => {
    it('ACTIVE → REJECTED (retirar) sigue por el genérico', () => {
      // Retirar un anuncio ya publicado es `deactivateListing`, otra acción con
      // su propio camino desde la pantalla de denuncias. Desde aquí es un cambio
      // de estado y así se queda: M2 no reabre eso.
      expect(elegirAccionDeEstado('ACTIVE', 'REJECTED')).toBe('generic');
    });

    it('DRAFT → ACTIVE (publicar por el admin) sigue por el genérico', () => {
      expect(elegirAccionDeEstado('DRAFT', 'ACTIVE')).toBe('generic');
    });

    it('ACTIVE → PENDING_REVIEW (mandar a revisión) sigue por el genérico', () => {
      expect(elegirAccionDeEstado('ACTIVE', 'PENDING_REVIEW')).toBe('generic');
    });
  });
});
