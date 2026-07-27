import { PDFDocument } from 'pdf-lib';
import { EmitInvoiceInput } from '../invoicing.types';
import { StubInvoicingProvider } from './stub-invoicing.provider';

function makeInput(idempotencyKey: string): EmitInvoiceInput {
  return {
    idempotencyKey,
    type: 'ORDINARY',
    issuer: { taxId: 'B12345678', name: 'Marketplace S.L.', city: 'Madrid', country: 'ES' },
    receiver: { taxId: '12345678Z', name: 'Ada Lovelace', city: 'Sevilla', country: 'ES' },
    currency: 'EUR',
    issueDate: new Date('2026-01-15T10:00:00.000Z'),
    lines: [
      {
        concept: 'Suscripción Pro (mensual)',
        amountNet: '8.26',
        taxRate: '0.2100',
        taxAmount: '1.73',
        amountGross: '9.99',
        operationDate: new Date('2026-01-15T10:00:00.000Z'),
      },
    ],
  };
}

describe('StubInvoicingProvider — emisión DE PRUEBA (NO válida fiscalmente)', () => {
  let provider: StubInvoicingProvider;

  beforeEach(() => {
    provider = new StubInvoicingProvider();
  });

  it('devuelve número de prueba, PDF y datos verifactu', async () => {
    const result = await provider.emitInvoice(makeInput('inv-1'));

    expect(result.number).toBe('DEV-2026-000001');
    expect(result.series).toBe('DEV-2026');
    expect(Buffer.isBuffer(result.pdf)).toBe(true);
    expect(result.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(result.verifactu.hash).toContain('DEV');
    expect(result.providerRef).toBe('stub:inv-1');
  });

  it('el PDF lleva el sello inequívoco "NO VALIDO FISCALMENTE" en sus metadatos', async () => {
    const result = await provider.emitInvoice(makeInput('inv-2'));

    // pdf-lib escribe los metadatos en UTF-16BE, así que NO se pueden buscar en
    // los bytes crudos como latin1. Se recargan y se leen decodificados. (El
    // sello VISUAL diagonal del cuerpo va en el stream del contenido y no es
    // texto plano buscable — se valida abriendo el PDF a ojo.)
    const loaded = await PDFDocument.load(result.pdf);
    // Title y Subject los fija el stub y pdf-lib no los sobrescribe; ambos llevan
    // el marcador. (Producer podría ser reemplazado por pdf-lib al guardar, así
    // que no se asienta sobre él.)
    expect(loaded.getTitle()).toContain(StubInvoicingProvider.INVALID_MARK);
    expect(loaded.getSubject()).toContain(StubInvoicingProvider.INVALID_MARK);
    expect(loaded.getTitle()).toContain('DOCUMENTO DE PRUEBA');
  });

  it('es idempotente: la misma idempotencyKey devuelve el MISMO número y PDF', async () => {
    const first = await provider.emitInvoice(makeInput('inv-same'));
    const second = await provider.emitInvoice(makeInput('inv-same'));

    expect(second.number).toBe(first.number);
    expect(second.pdf.equals(first.pdf)).toBe(true);
  });

  it('claves distintas incrementan el contador de prueba', async () => {
    const a = await provider.emitInvoice(makeInput('inv-a'));
    const b = await provider.emitInvoice(makeInput('inv-b'));

    expect(a.number).toBe('DEV-2026-000001');
    expect(b.number).toBe('DEV-2026-000002');
  });
});
