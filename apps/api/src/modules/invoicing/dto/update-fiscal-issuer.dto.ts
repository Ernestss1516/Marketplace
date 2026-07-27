import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsFiscalTaxId } from '../../../common/validators/spanish-tax-id';

/**
 * Datos fiscales del EMISOR (la plataforma), configurables desde admin (RF.13 R5).
 * Todos obligatorios: sin ellos requestInvoice/el cron fallan. El taxId se valida
 * con el mismo validador de formato NIF/DNI/NIE/CIF que el receptor. Estos datos
 * se CONGELAN en cada factura al emitir; cambiarlos NO altera las ya emitidas.
 */
export class UpdateFiscalIssuerDto {
  @IsString()
  @MaxLength(20)
  @IsFiscalTaxId()
  taxId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  fiscalName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  address!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10)
  postalCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  province!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country!: string;
}
