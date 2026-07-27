import { InvoiceType } from '@prisma/client';

/**
 * InvoicingProvider — el PUERTO de emisión de facturas (RF.13). Es el ÚNICO
 * punto NO in-house del sistema de facturación: la emisión fiscalmente VÁLIDA
 * (número correlativo, VeriFactu, PDF conforme) la aporta un proveedor
 * homologado externo detrás de esta interfaz. El resto del sistema habla SOLO
 * con este puerto; cambiar de proveedor = cambiar la implementación inyectada en
 * el token INVOICING_PROVIDER, nada más.
 *
 * Hasta conectar un proveedor homologado real, el token resuelve a
 * StubInvoicingProvider, que NO emite facturas válidas (ver diseno-facturacion.md §D).
 */

/** Token DI del puerto. Ver invoicing.module.ts para la selección por config. */
export const INVOICING_PROVIDER = 'INVOICING_PROVIDER';

/**
 * Datos fiscales CONGELADOS de una parte (emisor o receptor), tal como deben
 * figurar en la factura. Se copian de User / Setting fiscalIssuer en el momento
 * de emitir; el proveedor los imprime tal cual, no los reinterpreta.
 */
export interface FrozenFiscalParty {
  taxId: string;
  name: string;
  address?: string;
  city?: string;
  postalCode?: string;
  province?: string;
  country?: string;
}

/**
 * Una línea de la factura. Los importes van como string (Prisma.Decimal.toString())
 * para no perder precisión al cruzar el puerto — nunca como number/float.
 */
export interface InvoiceLineInput {
  concept: string;
  amountNet: string;
  taxRate: string;
  taxAmount: string;
  amountGross: string;
  operationDate: Date;
}

export interface EmitInvoiceInput {
  /**
   * = Invoice.id. Clave de idempotencia: el proveedor DEBE deduplicar reintentos
   * con esta clave (un job reintentado no puede consumir un número nuevo). Ver el
   * triple guard de idempotencia en el diseño §C.
   */
  idempotencyKey: string;
  type: InvoiceType; // ORDINARY | RECTIFICATIVE
  /** Solo en rectificativas: número de la factura original que se corrige. */
  rectifiesNumber?: string;
  issuer: FrozenFiscalParty;
  receiver: FrozenFiscalParty;
  currency: string;
  issueDate: Date;
  lines: InvoiceLineInput[];
}

/**
 * Datos VeriFactu que devuelve el proveedor (hash encadenado, QR, etc.). Los
 * GUARDAMOS como referencia; NO los generamos. Campos abiertos porque cada
 * proveedor devuelve su propio conjunto.
 */
export interface VerifactuData {
  hash: string;
  qr: string;
  [key: string]: unknown;
}

export interface EmitInvoiceResult {
  /** Número correlativo. Lo asigna el PROVEEDOR — NUNCA lo generamos nosotros. */
  number: string;
  series?: string;
  /**
   * Bytes del PDF. Preferimos recibir el binario para guardarlo NOSOTROS en R2
   * privado (control de retención + acceso autenticado), en vez de una URL
   * alojada por el proveedor.
   */
  pdf: Buffer;
  verifactu: VerifactuData;
  /** Id/eco de la operación en el proveedor (trazabilidad). */
  providerRef: string;
}

export interface InvoicingProvider {
  emitInvoice(input: EmitInvoiceInput): Promise<EmitInvoiceResult>;
}

/**
 * ¿Tiene el usuario los datos fiscales mínimos para ser RECEPTOR de una factura?
 * País tiene default 'ES'; entityType es opcional. Único punto de verdad,
 * reutilizado por la emisión manual (R3) y por el cron automático (R4).
 */
export function hasCompleteFiscalData(user: {
  fiscalTaxId?: string | null;
  fiscalName?: string | null;
  fiscalAddress?: string | null;
  fiscalCity?: string | null;
  fiscalPostalCode?: string | null;
  fiscalProvince?: string | null;
}): boolean {
  return Boolean(
    user.fiscalTaxId &&
      user.fiscalName &&
      user.fiscalAddress &&
      user.fiscalCity &&
      user.fiscalPostalCode &&
      user.fiscalProvince,
  );
}
