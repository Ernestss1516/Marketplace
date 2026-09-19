import { finDelMesNatural, inicioDelMesNatural, QUOTA_TIMEZONE } from './mes-natural';

/**
 * LA VENTANA DE LA CUOTA. Unidad pura: sin base de datos y sin esperar al calendario, que es
 * lo que permite probar el 1 de enero, el 29 de febrero y los dos cambios de hora —ninguno de
 * los tres se puede provocar de otra forma—. De esta aritmética depende cuánta cuota recibe
 * cada cliente que paga, así que se prueba entera.
 *
 * LOS INSTANTES SE ESCRIBEN EN UTC (`Date.UTC`) a propósito: es la única forma de que el caso
 * diga exactamente qué instante está probando sin depender de la zona del proceso que ejecuta
 * la batería. España es UTC+1 en invierno y UTC+2 en verano, así que el día 1 a las 00:00
 * peninsulares son las 23:00Z del último día del mes anterior en invierno, y las 22:00Z en
 * verano. Esa diferencia ES lo que estos casos vigilan.
 */
describe('cuota Pro — la ventana del mes natural', () => {
  describe('el inicio del mes, en hora peninsular', () => {
    it('en INVIERNO (CET, +1) el 1 de enero empieza a las 23:00Z del 31 de diciembre', () => {
      const aMitadDeEnero = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));

      expect(inicioDelMesNatural(aMitadDeEnero)).toEqual(new Date(Date.UTC(2025, 11, 31, 23, 0, 0)));
    });

    it('en VERANO (CEST, +2) el 1 de julio empieza a las 22:00Z del 30 de junio', () => {
      const aMitadDeJulio = new Date(Date.UTC(2026, 6, 15, 12, 0, 0));

      expect(inicioDelMesNatural(aMitadDeJulio)).toEqual(new Date(Date.UTC(2026, 5, 30, 22, 0, 0)));
    });

    /**
     * EL CASO QUE JUSTIFICA LA ZONA DECLARADA, y el único que distingue este código de un
     * `new Date(y, m, 1)` en un servidor en UTC.
     *
     * A la 01:00 peninsular del 1 de julio ya es julio: la cuota de junio se acaba de perder y
     * la de julio está entera. Ese mismo instante son las 23:00Z del 30 de junio, así que un
     * cálculo en UTC diría «todavía es junio» y contaría lo gastado esa hora contra el mes
     * anterior — le comería cuota a alguien que ya estrenó mes.
     */
    it('a la 01:00 peninsular del 1 de julio YA es julio (en UTC todavía sería el 30 de junio)', () => {
      const laUnaDeLaMadrugadaPeninsular = new Date(Date.UTC(2026, 5, 30, 23, 0, 0));

      expect(inicioDelMesNatural(laUnaDeLaMadrugadaPeninsular)).toEqual(
        new Date(Date.UTC(2026, 5, 30, 22, 0, 0)),
      );
    });

    it('y una hora antes —23:00 peninsular del 30 de junio— todavía es junio', () => {
      const laNocheAntes = new Date(Date.UTC(2026, 5, 30, 21, 0, 0));

      expect(inicioDelMesNatural(laNocheAntes)).toEqual(new Date(Date.UTC(2026, 4, 31, 22, 0, 0)));
    });

    it('el primer instante del mes se pertenece a sí mismo (borde inclusivo)', () => {
      const elPrimerInstanteDeMarzo = new Date(Date.UTC(2026, 1, 28, 23, 0, 0));

      expect(inicioDelMesNatural(elPrimerInstanteDeMarzo)).toEqual(elPrimerInstanteDeMarzo);
    });

    it('el último instante del mes sigue siendo de ese mes', () => {
      const unMilisegundoAntesDeMarzo = new Date(Date.UTC(2026, 1, 28, 22, 59, 59, 999));

      expect(inicioDelMesNatural(unMilisegundoAntesDeMarzo)).toEqual(
        new Date(Date.UTC(2026, 0, 31, 23, 0, 0)),
      );
    });
  });

  describe('el cambio de hora cae DENTRO del mes', () => {
    /**
     * España pasa a horario de verano el último domingo de marzo (29 de marzo de 2026). Un
     * instante del 30 de marzo ya está en CEST (+2), pero el inicio de SU mes —el 1 de marzo—
     * todavía está en CET (+1). Sin la corrección en dos pasadas, el borde quedaría una hora
     * movido: el 28 de febrero a las 23:00Z en vez del 1 de marzo peninsular.
     */
    it('desde el 30 de marzo (ya CEST) el inicio de marzo se calcula en CET', () => {
      const trasElCambio = new Date(Date.UTC(2026, 2, 30, 10, 0, 0));

      expect(inicioDelMesNatural(trasElCambio)).toEqual(new Date(Date.UTC(2026, 1, 28, 23, 0, 0)));
    });

    it('y el fin de marzo —el 1 de abril— se calcula en CEST', () => {
      const antesDelCambio = new Date(Date.UTC(2026, 2, 5, 10, 0, 0));

      expect(finDelMesNatural(antesDelCambio)).toEqual(new Date(Date.UTC(2026, 2, 31, 22, 0, 0)));
    });

    it('el cambio de OTOÑO (último domingo de octubre) tampoco mueve el borde', () => {
      const trasElCambio = new Date(Date.UTC(2026, 9, 30, 10, 0, 0));

      // 1 de octubre en CEST (+2) → 22:00Z del 30 de septiembre.
      expect(inicioDelMesNatural(trasElCambio)).toEqual(new Date(Date.UTC(2026, 8, 30, 22, 0, 0)));
      // 1 de noviembre ya en CET (+1) → 23:00Z del 31 de octubre.
      expect(finDelMesNatural(trasElCambio)).toEqual(new Date(Date.UTC(2026, 9, 31, 23, 0, 0)));
    });
  });

  describe('los bordes del calendario', () => {
    it('diciembre desborda a enero del año siguiente', () => {
      const enDiciembre = new Date(Date.UTC(2026, 11, 20, 12, 0, 0));

      expect(finDelMesNatural(enDiciembre)).toEqual(new Date(Date.UTC(2026, 11, 31, 23, 0, 0)));
    });

    it('febrero de un año BISIESTO acaba el 1 de marzo, no el 29 de febrero', () => {
      const enFebreroBisiesto = new Date(Date.UTC(2028, 1, 10, 12, 0, 0));

      expect(finDelMesNatural(enFebreroBisiesto)).toEqual(new Date(Date.UTC(2028, 1, 29, 23, 0, 0)));
    });

    it('febrero de un año NO bisiesto acaba el 1 de marzo igualmente', () => {
      const enFebrero = new Date(Date.UTC(2026, 1, 10, 12, 0, 0));

      expect(finDelMesNatural(enFebrero)).toEqual(new Date(Date.UTC(2026, 1, 28, 23, 0, 0)));
    });

    it('un mes de 31 días no se sale al mes siguiente', () => {
      const enEnero = new Date(Date.UTC(2026, 0, 31, 12, 0, 0));

      expect(inicioDelMesNatural(enEnero)).toEqual(new Date(Date.UTC(2025, 11, 31, 23, 0, 0)));
      expect(finDelMesNatural(enEnero)).toEqual(new Date(Date.UTC(2026, 0, 31, 23, 0, 0)));
    });
  });

  describe('las dos funciones encajan', () => {
    it('el fin de un mes es el inicio del siguiente — sin hueco ni solape', () => {
      const enSeptiembre = new Date(Date.UTC(2026, 8, 19, 12, 0, 0));
      const fin = finDelMesNatural(enSeptiembre);

      // Ese mismo instante, preguntado por SU mes, se contesta a sí mismo: no hay
      // milisegundo que quede fuera de las dos ventanas ni dentro de las dos.
      expect(inicioDelMesNatural(fin)).toEqual(fin);
    });

    it('la ventana contiene el instante desde el que se calcula', () => {
      const ahora = new Date(Date.UTC(2026, 3, 17, 5, 30, 0));

      expect(inicioDelMesNatural(ahora).getTime()).toBeLessThanOrEqual(ahora.getTime());
      expect(finDelMesNatural(ahora).getTime()).toBeGreaterThan(ahora.getTime());
    });

    it('la zona está declarada, no heredada del proceso', () => {
      expect(QUOTA_TIMEZONE).toBe('Europe/Madrid');
    });
  });
});
