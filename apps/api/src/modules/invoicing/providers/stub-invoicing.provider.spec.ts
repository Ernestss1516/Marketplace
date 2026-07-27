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

  it('el PDF lleva el sello inequívoco "NO VALIDO FISCALMENTE"', async () => {
    const result = await provider.emitInvoice(makeInput('inv-2'));
    const bytes = result.pdf.toString('latin1');
    expect(bytes).toContain(StubInvoicingProvider.INVALID_MARK); // "NO VALIDO FISCALMENTE"
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
