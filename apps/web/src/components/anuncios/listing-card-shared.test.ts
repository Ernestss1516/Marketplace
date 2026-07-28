// RP.4a — CONTRATO DEL REFACTOR: hasta esta ráfaga había TRES copias idénticas
// de formatPrice (listing-card-shared.tsx, MyListingCard.tsx y la ficha
// /anuncio/[slug]). 4a las unifica en una sola SIN cambiar comportamiento; los
// casos de este bloque fijan exactamente las salidas de antes del refactor, para
// que si 4b (añadir el sufijo de formato) rompiera algo, se vea que fue 4b y no
// la consolidación.
import { formatListingPrice } from './listing-card-shared';

// Intl.NumberFormat('es-ES') separa importe y símbolo con un espacio DURO
// (U+00A0), no un espacio normal. Se escribe explícito para que las aserciones
// no dependan de copiar-pegar un carácter invisible.
const NB = ' ';

describe('formatListingPrice — salidas previas a RP.4 (contrato del refactor)', () => {
  it('FIXED → importe formateado en es-ES con el símbolo de la moneda', () => {
    expect(formatListingPrice(200, 'EUR', 'FIXED')).toBe(`200,00${NB}€`);
  });

  it('FIXED con decimales', () => {
    expect(formatListingPrice(9.99, 'EUR', 'FIXED')).toBe(`9,99${NB}€`);
  });

  it('FIXED con cuatro cifras', () => {
    expect(formatListingPrice(1500, 'EUR', 'FIXED')).toBe(`1500,00${NB}€`);
  });

  it('FIXED a 0 sigue mostrando el importe (0 no es "Gratis": eso lo dice priceType)', () => {
    expect(formatListingPrice(0, 'EUR', 'FIXED')).toBe(`0,00${NB}€`);
  });

  it('FREE → "Gratis", ignorando el importe', () => {
    expect(formatListingPrice(0, 'EUR', 'FREE')).toBe('Gratis');
    expect(formatListingPrice(50, 'EUR', 'FREE')).toBe('Gratis');
  });

  it('NEGOTIABLE → "A convenir", ignorando el importe', () => {
    expect(formatListingPrice(0, 'EUR', 'NEGOTIABLE')).toBe('A convenir');
    expect(formatListingPrice(300, 'EUR', 'NEGOTIABLE')).toBe('A convenir');
  });

  it('respeta la moneda recibida', () => {
    expect(formatListingPrice(100, 'USD', 'FIXED')).toBe(`100,00${NB}US$`);
  });
});

// ─── RP.4b — sufijo de formato ──────────────────────────────────────────────

describe('formatListingPrice — sufijo de formato (RP.4b)', () => {
  // REQUISITO DE ORO: el 4º parámetro tiene default ONE_TIME, así que todas las
  // llamadas de tres argumentos (y todos los anuncios anteriores a RP.1) siguen
  // dando exactamente lo mismo.
  it('omitir priceUnit equivale a ONE_TIME y no añade sufijo', () => {
    expect(formatListingPrice(200, 'EUR', 'FIXED')).toBe(`200,00${NB}€`);
    expect(formatListingPrice(200, 'EUR', 'FIXED', 'ONE_TIME')).toBe(`200,00${NB}€`);
  });

  it('priceUnit undefined explícito (hit de Meilisearch sin reindexar) → sin sufijo', () => {
    expect(formatListingPrice(200, 'EUR', 'FIXED', undefined)).toBe(`200,00${NB}€`);
  });

  it('FIXED + PER_MONTH → "9,99 €/mes"', () => {
    expect(formatListingPrice(9.99, 'EUR', 'FIXED', 'PER_MONTH')).toBe(`9,99${NB}€/mes`);
  });

  it('FIXED + PER_HOUR → "15 €/hora"', () => {
    expect(formatListingPrice(15, 'EUR', 'FIXED', 'PER_HOUR')).toBe(`15,00${NB}€/hora`);
  });

  it('cubre los siete formatos con su etiqueta', () => {
    const cases: [Parameters<typeof formatListingPrice>[3], string][] = [
      ['ONE_TIME', ''],
      ['PER_MONTH', '/mes'],
      ['PER_WEEK', '/semana'],
      ['PER_DAY', '/día'],
      ['PER_HOUR', '/hora'],
      ['PER_UNIT', '/ud.'],
      ['PER_SESSION', '/sesión'],
    ];
    for (const [unit, suffix] of cases) {
      expect(formatListingPrice(10, 'EUR', 'FIXED', unit)).toBe(`10,00${NB}€${suffix}`);
    }
  });

  // FREE es la ÚNICA rama que sale sin sufijo: un anuncio gratis no se cobra
  // por hora ni por mes, así que "Gratis" es la lectura completa.
  it('FREE nunca lleva sufijo, aunque el anuncio tenga un formato guardado', () => {
    expect(formatListingPrice(0, 'EUR', 'FREE', 'PER_MONTH')).toBe('Gratis');
    expect(formatListingPrice(0, 'EUR', 'FREE', 'PER_HOUR')).toBe('Gratis');
  });

  // NEGOTIABLE SÍ lo lleva: "alquiler a convenir, al mes" es un caso real, y por
  // eso esta rama no puede hacer un return temprano antes de aplicar el sufijo.
  it('NEGOTIABLE + PER_MONTH → "A convenir/mes"', () => {
    expect(formatListingPrice(0, 'EUR', 'NEGOTIABLE', 'PER_MONTH')).toBe('A convenir/mes');
  });

  it('NEGOTIABLE + PER_HOUR → "A convenir/hora"', () => {
    expect(formatListingPrice(0, 'EUR', 'NEGOTIABLE', 'PER_HOUR')).toBe('A convenir/hora');
  });

  it('NEGOTIABLE + ONE_TIME sigue siendo "A convenir" a secas (como antes de RP.4)', () => {
    expect(formatListingPrice(0, 'EUR', 'NEGOTIABLE', 'ONE_TIME')).toBe('A convenir');
    expect(formatListingPrice(0, 'EUR', 'NEGOTIABLE')).toBe('A convenir');
  });
});
