/**
 * Validación de FORMATO de identificador fiscal en el cliente (RF.13), espejo de
 * `apps/api/src/common/validators/spanish-tax-id.ts`. Solo para feedback
 * inmediato en el formulario; la validación de verdad la hace el backend. NO es
 * comprobación de conformidad fiscal ni de existencia real del NIF.
 */

const DNI_CONTROL = 'TRWAGMYFPDXBNJZSQVHLCKE';
const CIF_CONTROL_LETTERS = 'JABCDEFGHI';
const NIE_PREFIX: Record<string, string> = { X: '0', Y: '1', Z: '2' };

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
      n *= 2;
      if (n > 9) n = Math.floor(n / 10) + (n % 10);
    }
    sum += n;
  }
  const controlDigit = (10 - (sum % 10)) % 10;
  const expectedDigit = String(controlDigit);
  const expectedLetter = CIF_CONTROL_LETTERS[controlDigit];

  if (/^[PQSNW]$/.test(orgLetter)) return control === expectedLetter;
  if (/^[ABEH]$/.test(orgLetter)) return control === expectedDigit;
  return control === expectedDigit || control === expectedLetter;
}

function looksSpanish(value: string): boolean {
  return /^[XYZ]?\d{7,8}[0-9A-J]$/.test(value) || /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(value);
}

/** Ver el comentario de cabecera. Cadena vacía → false. */
export function isValidFiscalTaxId(raw: string): boolean {
  const value = normalize(raw);
  if (!value) return false;
  if (isValidDni(value) || isValidNie(value) || isValidCif(value)) return true;
  if (looksSpanish(value)) return false;
  return /^[A-Z0-9]{3,20}$/.test(value);
}
