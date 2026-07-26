import { isValidFiscalTaxId } from './spanish-tax-id';

describe('isValidFiscalTaxId — validación de formato de identificador fiscal (RF.13)', () => {
  it('acepta DNI con letra de control correcta', () => {
    expect(isValidFiscalTaxId('12345678Z')).toBe(true);
    expect(isValidFiscalTaxId('12345678-Z')).toBe(true); // normaliza guiones
    expect(isValidFiscalTaxId(' 12345678z ')).toBe(true); // normaliza espacios y minúsculas
  });

  it('rechaza DNI con letra de control incorrecta', () => {
    expect(isValidFiscalTaxId('12345678A')).toBe(false);
  });

  it('acepta NIE con letra de control correcta', () => {
    expect(isValidFiscalTaxId('X1234567L')).toBe(true);
  });

  it('rechaza NIE con control incorrecto', () => {
    expect(isValidFiscalTaxId('X1234567A')).toBe(false);
  });

  it('acepta CIF válido', () => {
    expect(isValidFiscalTaxId('A58818501')).toBe(true);
  });

  it('rechaza CIF con control incorrecto', () => {
    expect(isValidFiscalTaxId('A58818500')).toBe(false);
  });

  it('acepta un identificador extranjero acotado (fallback tolerante)', () => {
    expect(isValidFiscalTaxId('DE123456789')).toBe(true);
    expect(isValidFiscalTaxId('IE1234567X')).toBe(true);
  });

  it('rechaza algo que aparenta un identificador español mal formado', () => {
    expect(isValidFiscalTaxId('00000000A')).toBe(false); // forma de DNI, control no cuadra
  });

  it('rechaza cadena vacía o basura', () => {
    expect(isValidFiscalTaxId('')).toBe(false);
    expect(isValidFiscalTaxId('!!')).toBe(false);
  });
});
