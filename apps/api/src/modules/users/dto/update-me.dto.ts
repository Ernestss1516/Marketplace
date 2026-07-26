import { IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { FiscalEntityType } from '@prisma/client';
import { IsFiscalTaxId } from '../../../common/validators/spanish-tax-id';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  postalCode?: string;

  // --- Datos fiscales (receptor de facturas — RF.13). Todos opcionales: el
  // usuario los rellena cuando quiere facturar. Validación de FORMATO, no de
  // conformidad fiscal (eso lo valida el asesor). Se congelan en la Invoice al
  // emitir; aquí son editables.
  @IsOptional()
  @ValidateIf((o: UpdateMeDto) => o.fiscalTaxId !== '')
  @IsString()
  @MaxLength(20)
  @IsFiscalTaxId()
  fiscalTaxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  fiscalName?: string;

  @IsOptional()
  @IsEnum(FiscalEntityType)
  fiscalEntityType?: FiscalEntityType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  fiscalAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fiscalCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  fiscalPostalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fiscalProvince?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  fiscalCountry?: string;
}
