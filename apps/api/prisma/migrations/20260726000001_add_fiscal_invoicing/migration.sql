-- CreateEnum
CREATE TYPE "FiscalEntityType" AS ENUM ('INDIVIDUAL', 'SELF_EMPLOYED', 'COMPANY');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('ORDINARY', 'RECTIFICATIVE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'FAILED');

-- CreateEnum
CREATE TYPE "InvoiceOrigin" AS ENUM ('AUTO_PERIODIC', 'USER_REQUESTED', 'ADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "fiscalAddress" TEXT,
ADD COLUMN     "fiscalCity" TEXT,
ADD COLUMN     "fiscalCountry" TEXT DEFAULT 'ES',
ADD COLUMN     "fiscalEntityType" "FiscalEntityType",
ADD COLUMN     "fiscalName" TEXT,
ADD COLUMN     "fiscalPostalCode" TEXT,
ADD COLUMN     "fiscalProvince" TEXT,
ADD COLUMN     "fiscalTaxId" TEXT;

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "series" TEXT,
    "type" "InvoiceType" NOT NULL DEFAULT 'ORDINARY',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "origin" "InvoiceOrigin" NOT NULL,
    "userId" TEXT NOT NULL,
    "receiverTaxId" TEXT,
    "receiverName" TEXT,
    "receiverEntityType" "FiscalEntityType",
    "receiverAddress" TEXT,
    "receiverCity" TEXT,
    "receiverPostalCode" TEXT,
    "receiverProvince" TEXT,
    "receiverCountry" TEXT,
    "issuerTaxId" TEXT,
    "issuerName" TEXT,
    "issuerAddress" TEXT,
    "issuerCity" TEXT,
    "issuerPostalCode" TEXT,
    "issuerProvince" TEXT,
    "issuerCountry" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "subtotalNet" DECIMAL(10,2) NOT NULL,
    "totalTax" DECIMAL(10,2) NOT NULL,
    "totalGross" DECIMAL(10,2) NOT NULL,
    "periodKey" TEXT,
    "issuedAt" TIMESTAMP(3),
    "pdfKey" TEXT,
    "verifactuHash" TEXT,
    "verifactuQr" TEXT,
    "providerRef" TEXT,
    "rectifiesInvoiceId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "amountNet" DECIMAL(10,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL,
    "taxRate" DECIMAL(5,4) NOT NULL,
    "amountGross" DECIMAL(10,2) NOT NULL,
    "operationDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_idempotencyKey_key" ON "Invoice"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Invoice_userId_idx" ON "Invoice"("userId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_periodKey_idx" ON "Invoice"("periodKey");

-- CreateIndex
CREATE INDEX "Invoice_issuedAt_idx" ON "Invoice"("issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_transactionId_key" ON "InvoiceLine"("transactionId");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_rectifiesInvoiceId_fkey" FOREIGN KEY ("rectifiesInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
