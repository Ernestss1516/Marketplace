import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Validación de FORMATO de identificador fiscal para los datos de facturación
 * del receptor (RF.13). NO es una comprobación de conformidad fiscal ni de
 * existencia real del NIF — solo verifica el dígito/carácter de control del
 * formato español (DNI/NIE/CIF). Un ID extranjero (fiscalCountry != ES) no
 * sigue este formato: por eso el fallback acepta cualquier alfanumérico acotado
 * que NO aparente ser un identificador español mal formado.
 *
 * Exportada como función pura (reutilizable en servicios) Y como decorador
 * `@IsFiscalTaxId()` para los DTOs. El front replica esta misma lógica para dar
 * feedback inmediato; la validación de verdad es esta, en el backend.
 */

const DNI_CONTROL = 'TRWAGMYFPDXBNJZSQVHLCKE';
const CIF_CONTROL_LETTERS = 'JABCDEFGHI';
const NIE_PREFIX: Record<string, string> = { X: '0', Y: '1', Z: '2' };

/** Mayúsculas y sin espacios ni guiones. */
function normalize(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, '');
}

function isValidDni(value: string): boolean {
  const m = /^(\d{8})([A-Z])$/.exec(value);
  if (!m) return false;
  return DNI_CONTROL[Number(m[1]) % 23] === m[2];
}

function isValidNie(value: string): boolean {
  const m = /^([XYZ])(\d{7})([A-Z])$/.exec(value);
  if (!m) return false;
  return DNI_CONTROL[Number(NIE_PREFIX[m[1]] + m[2]) % 23] === m[3];
}

function isValidCif(value: string): boolean {
  const m = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(value);
  if (!m) return false;
  const [, orgLetter, digits, control] = m;

  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[i]);
    if (i % 2 === 0) {
      // Posiciones impares (1-based): se duplican y se suman sus cifras.
      n *= 2;
      if (n > 9) n = Math.floor(n / 10) + (n % 10);
    }
    sum += n;
  }
  const controlDigit = (10 - (sum % 10)) % 10;
  const expectedDigit = String(controlDigit);
  const expectedLetter = CIF_CONTROL_LETTERS[controlDigit];

  // Organizaciones que EXIGEN letra de control (PQSNW) o dígito (ABEH); el resto
  // admiten cualquiera de los dos.
  if (/^[PQSNW]$/.test(orgLetter)) return control === expectedLetter;
  if (/^[ABEH]$/.test(orgLetter)) return control === expectedDigit;
  return control === expectedDigit || control === expectedLetter;
}

/** ¿Tiene la forma de un identificador fiscal español (aunque el control falle)? */
function looksSpanish(value: string): boolean {
  return /^[XYZ]?\d{7,8}[0-9A-J]$/.test(value) || /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(value);
}

/**
 * Valida el FORMATO de un identificador fiscal. Español (DNI/NIE/CIF): verifica
 * el control. Extranjero: acepta 3-20 alfanuméricos que no aparenten un español
 * mal formado. Cadena vacía → false (los DTOs la filtran antes con @IsOptional).
 */
export function isValidFiscalTaxId(raw: string): boolean {
  const value = normalize(raw);
  if (!value) return false;
  if (isValidDni(value) || isValidNie(value) || isValidCif(value)) return true;
  if (looksSpanish(value)) return false; // aparentaba español pero el control no cuadra
  return /^[A-Z0-9]{3,20}$/.test(value);
}

/** Decorador class-validator para `isValidFiscalTaxId` — ver el comentario de arriba. */
export function IsFiscalTaxId(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isFiscalTaxId',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isValidFiscalTaxId(value);
        },
        defaultMessage(): string {
          return `${propertyName} no tiene un formato válido de NIF/DNI/NIE/CIF`;
        },
      },
    });
  };
}
