import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { cleanDb } from './helpers/db';

/**
 * Guard de inmutabilidad de facturas (RF.13) — EJERCIDO a nivel de BD, no
 * declarado. Comprueba que el trigger de Postgres (migración
 * 20260727000001_invoice_immutability_guard) rechaza cualquier mutación de una
 * Invoice ISSUED, atacándola con SQL DIRECTO (no por la capa de servicio, que es
 * justo lo que un trigger debe blindar). Incluye el sanity-check de desactivar el
 * trigger para probar que ES él quien protege, no otra cosa.
 */
describe('Inmutabilidad de facturas ISSUED (trigger de BD) — e2e', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createUser() {
    const id = randomUUID().slice(0, 8);
    return prisma.user.create({
      data: { email: `inv-${id}@test.local`, name: `Inv ${id}`, slug: `inv-${id}` },
    });
  }

  async function createSucceededTransaction(userId: string) {
    const product = await prisma.product.create({
      data: { name: `Prod ${randomUUID().slice(0, 6)}`, type: 'ONE_TIME' },
    });
    const price = await prisma.price.create({
      data: { productId: product.id, amount: '9.99' },
    });
    return prisma.transaction.create({
      data: {
        userId,
        priceId: price.id,
        amountGross: '9.99',
        amountNet: '8.26',
        taxAmount: '1.73',
        taxRate: '0.2100',
        status: 'SUCCEEDED',
      },
    });
  }

  /** Crea una Invoice DRAFT y la latch-ea a ISSUED (transición permitida). */
  async function createIssuedInvoice(withLine = false) {
    const user = await createUser();
    const tx = withLine ? await createSucceededTransaction(user.id) : null;

    const draft = await prisma.invoice.create({
      data: {
        origin: 'USER_REQUESTED',
        userId: user.id,
        subtotalNet: '8.26',
        totalTax: '1.73',
        totalGross: '9.99',
        ...(tx
          ? {
              lines: {
                create: [
                  {
                    transactionId: tx.id,
                    concept: 'Destacado 30d',
                    amountNet: '8.26',
                    taxAmount: '1.73',
                    taxRate: '0.2100',
                    amountGross: '9.99',
                    operationDate: new Date(),
                  },
                ],
              },
            }
          : {}),
      },
      include: { lines: true },
    });

    const issued = await prisma.invoice.update({
      where: { id: draft.id },
      data: {
        status: 'ISSUED',
        number: 'DEV-2026-000001',
        series: 'DEV-2026',
        issuedAt: new Date(),
        pdfKey: `facturas/${draft.id}.pdf`,
      },
      include: { lines: true },
    });

    return { issued, user, tx, lineId: draft.lines[0]?.id };
  }

  it('el latch DRAFT → ISSUED se permite (rellena número/pdf/issuedAt una vez)', async () => {
    const { issued } = await createIssuedInvoice();
    expect(issued.status).toBe('ISSUED');
    expect(issued.number).toBe('DEV-2026-000001');
    expect(issued.issuedAt).not.toBeNull();
  });

  it('UPDATE directo del número de una factura ISSUED → RECHAZADO', async () => {
    const { issued } = await createIssuedInvoice();
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "Invoice" SET "number" = 'HACKED' WHERE id = $1`, issued.id),
    ).rejects.toThrow();

    const after = await prisma.invoice.findUnique({ where: { id: issued.id } });
    expect(after?.number).toBe('DEV-2026-000001'); // intacto
  });

  it('UPDATE directo de un importe de una factura ISSUED → RECHAZADO', async () => {
    const { issued } = await createIssuedInvoice();
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "Invoice" SET "totalGross" = '9999.00' WHERE id = $1`, issued.id),
    ).rejects.toThrow();

    const after = await prisma.invoice.findUnique({ where: { id: issued.id } });
    expect(after?.totalGross.toString()).toBe('9.99');
  });

  it('DELETE directo de una factura ISSUED → RECHAZADO', async () => {
    const { issued } = await createIssuedInvoice();
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "Invoice" WHERE id = $1`, issued.id),
    ).rejects.toThrow();

    const after = await prisma.invoice.findUnique({ where: { id: issued.id } });
    expect(after).not.toBeNull();
  });

  it('las líneas de una factura ISSUED son inmutables (UPDATE/DELETE/INSERT rechazados)', async () => {
    const { issued, lineId } = await createIssuedInvoice(true);
    expect(lineId).toBeDefined();

    // UPDATE de una línea existente
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "InvoiceLine" SET "concept" = 'HACK' WHERE id = $1`, lineId),
    ).rejects.toThrow();

    // DELETE de una línea existente
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "InvoiceLine" WHERE id = $1`, lineId),
    ).rejects.toThrow();

    // INSERT de una línea nueva en la factura ISSUED (con otra Transaction)
    const tx2 = await createSucceededTransaction(issued.userId);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "InvoiceLine"
           (id, "invoiceId", "transactionId", concept, "amountNet", "taxAmount", "taxRate", "amountGross", "operationDate")
         VALUES ($1, $2, $3, 'Hack line', '1.00', '0.21', '0.2100', '1.21', NOW())`,
        `line-hack-${randomUUID().slice(0, 8)}`,
        issued.id,
        tx2.id,
      ),
    ).rejects.toThrow();

    const line = await prisma.invoiceLine.findUnique({ where: { id: lineId } });
    expect(line?.concept).toBe('Destacado 30d'); // intacta
  });

  it('sanity: al DESACTIVAR el trigger, el UPDATE malicioso SÍ pasa (prueba de que es el trigger quien protege)', async () => {
    const { issued } = await createIssuedInvoice();
    await prisma.$executeRawUnsafe(`ALTER TABLE "Invoice" DISABLE TRIGGER "invoice_immutable_guard"`);
    try {
      await prisma.$executeRawUnsafe(`UPDATE "Invoice" SET "number" = 'HACKED' WHERE id = $1`, issued.id);
      const after = await prisma.invoice.findUnique({ where: { id: issued.id } });
      expect(after?.number).toBe('HACKED');
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Invoice" ENABLE TRIGGER "invoice_immutable_guard"`);
    }
  });
});
