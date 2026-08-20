import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * FICHA DE USUARIO — U2: dar bumps a un usuario.
 *
 * Copia literal de `CreditGrantDto` sobre la otra moneda. Los bumps son un saldo
 * aparte (`Wallet.bumpBalance` + `BumpLedger`), intransferible y sólo válido para
 * bumps, así que dar bumps no es un caso especial de dar créditos: es el mismo
 * molde sobre otra columna. Dar créditos ya existía; esto era el hueco.
 *
 * Mismos topes (1..10000) a propósito: son la misma clase de acción y no hay
 * ningún motivo para que la salvaguarda sea distinta.
 */
export class BumpGrantDto {
  @IsInt()
  @Min(1)
  @Max(10000)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
