import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { InvoiceOrigin, InvoiceStatus } from '@prisma/client';

/** Filtros + paginación del listado admin de facturas (RF.13 R5). Molde de ListAdminTransactionsDto. */
export class ListAdminInvoicesDto {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsEnum(InvoiceOrigin)
  origin?: InvoiceOrigin;

  @IsOptional()
  @IsString()
  periodKey?: string;

  /** Filtro por usuario exacto (id). */
  @IsOptional()
  @IsString()
  userId?: string;

  /** Búsqueda por email/nombre del receptor. */
  @IsOptional()
  @IsString()
  userQuery?: string;

  /** Rango sobre issuedAt. */
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  perPage?: number = 25;
}
