import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import {
  EmitInvoiceInput,
  EmitInvoiceResult,
  InvoicingProvider,
} from '../invoicing.types';

/**
 * ⚠️ StubInvoicingProvider — IMPLEMENTACIÓN DE DESARROLLO. NO EMITE FACTURAS
 * FISCALMENTE VÁLIDAS. ⚠️
 *
 * Existe para poder construir y probar TODO el flujo de facturación (emisión,
 * congelación, almacenamiento, admin) SIN un proveedor homologado real. Hasta
 * que Ernest elija un proveedor y se conecte su implementación:
 *   - el número que genera es un CONTADOR LOCAL de prueba ("DEV-YYYY-NNNNNN"),
 *     NO una serie fiscal correlativa real;
 *   - el PDF lleva un sello grande e inequívoco "NO VÁLIDO FISCALMENTE";
 *   - los datos VeriFactu (hash/qr) son de RELLENO, no verificables.
 *
 * El sistema queda COMPLETO pero NO factura fiscalmente hasta ese momento.
 *
 * Idempotencia: cachea el resultado por idempotencyKey (= Invoice.id), imitando
 * a un proveedor real — un reintento con la misma clave devuelve el MISMO número
 * y el MISMO PDF, nunca uno nuevo. Es lo que permite probar el nivel-proveedor
 * del triple guard de idempotencia (diseño §C) contra el stub.
 */
@Injectable()
export class StubInvoicingProvider implements InvoicingProvider {
  /** Marcador ASCII estable — va en los metadatos del PDF para tests y visores. */
  static readonly INVALID_MARK = 'NO VALIDO FISCALMENTE';

  private readonly logger = new Logger(StubInvoicingProvider.name);
  private seq = 0;
  private readonly cache = new Map<string, EmitInvoiceResult>();

  async emitInvoice(input: EmitInvoiceInput): Promise<EmitInvoiceResult> {
    const cached = this.cache.get(input.idempotencyKey);
    if (cached) return cached;

    this.logger.warn(
      `StubInvoicingProvider: generando factura DE PRUEBA (NO VÁLIDA FISCALMENTE) ` +
        `para idempotencyKey=${input.idempotencyKey}. Conecta un proveedor homologado para emitir de verdad.`,
    );

    this.seq += 1;
    const year = input.issueDate.getFullYear();
    const number = `DEV-${year}-${String(this.seq).padStart(6, '0')}`;

    const pdf = await this.buildPlaceholderPdf(input, number);

    const result: EmitInvoiceResult = {
      number,
      series: `DEV-${year}`,
      pdf,
      verifactu: {
        hash: `DEV-HASH-${input.idempotencyKey}`,
        qr: `DEV-QR-NO-VALIDO-${number}`,
        note: 'NO VÁLIDO FISCALMENTE — datos VeriFactu ficticios de desarrollo',
      },
      providerRef: `stub:${input.idempotencyKey}`,
    };

    this.cache.set(input.idempotencyKey, result);
    return result;
  }

  private async buildPlaceholderPdf(
    input: EmitInvoiceInput,
    number: string,
  ): Promise<Buffer> {
    const pdf = await PDFDocument.create();

    // Metadatos ASCII — marcador estable y buscable en los bytes (tests + visores
    // que muestran propiedades del documento).
    pdf.setTitle(`DOCUMENTO DE PRUEBA - ${StubInvoicingProvider.INVALID_MARK} (DESARROLLO)`);
    pdf.setSubject(
      `${StubInvoicingProvider.INVALID_MARK} - documento de desarrollo generado por ` +
        `StubInvoicingProvider; NO es una factura real`,
    );
    pdf.setProducer(`Marketplace StubInvoicingProvider - ${StubInvoicingProvider.INVALID_MARK}`);
    pdf.setCreator('Marketplace (DEV stub)');

    const page = pdf.addPage([595.28, 841.89]); // A4
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    // Sello diagonal grande e inequívoco.
    page.drawText('NO VÁLIDO FISCALMENTE', {
      x: 55,
      y: 470,
      size: 30,
      font: bold,
      color: rgb(0.85, 0.1, 0.1),
      rotate: degrees(35),
      opacity: 0.55,
    });
    page.drawText('DOCUMENTO DE PRUEBA / DESARROLLO', {
      x: 80,
      y: 435,
      size: 15,
      font: bold,
      color: rgb(0.85, 0.1, 0.1),
      rotate: degrees(35),
      opacity: 0.55,
    });

    // Cabecera legible (contenido simulado).
    let y = 800;
    const draw = (text: string, size = 10, font = helv): void => {
      page.drawText(text, { x: 50, y, size, font, color: rgb(0, 0, 0) });
      y -= size + 6;
    };

    draw('FACTURA (SIMULADA — NO VÁLIDA FISCALMENTE)', 14, bold);
    draw(`Número (de prueba): ${number}`);
    draw(`Fecha de emisión: ${input.issueDate.toISOString().slice(0, 10)}`);
    draw(`Emisor: ${input.issuer.name} — ${input.issuer.taxId}`);
    draw(`Receptor: ${input.receiver.name} — ${input.receiver.taxId}`);
    y -= 8;
    draw('Conceptos:', 11, bold);
    for (const l of input.lines) {
      draw(`- ${l.concept}: base ${l.amountNet} + IVA ${l.taxAmount} = ${l.amountGross} ${input.currency}`);
    }
    y -= 12;
    draw('Este documento lo ha generado un STUB de desarrollo. NO tiene validez fiscal.', 9);
    draw('La factura válida la emitirá el proveedor homologado cuando se conecte.', 9);

    // useObjectStreams: false → los metadatos (marcador "NO VALIDO FISCALMENTE")
    // quedan como literales en los bytes, buscables por tests y visores.
    const bytes = await pdf.save({ useObjectStreams: false });
    return Buffer.from(bytes);
  }
}
