import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * FICHA DE USUARIO — U2: QUITAR saldo (decisión D-2, aprobada).
 *
 * POR QUÉ EXISTE. Hasta ahora sólo se podía dar (`CreditGrantDto` tiene
 * `@Min(1)`), así que una concesión equivocada —un cero de más— no tenía
 * deshacer. El caso que lo motiva es corregir un error del propio staff.
 *
 * LO QUE NO PUEDE PROMETER, y conviene que esté escrito donde se usa: el monedero
 * es un **escalar** (`Wallet.balance`, `Wallet.bumpBalance`). El ledger registra
 * los movimientos, pero el saldo restante **no sabe de dónde vino cada unidad**:
 * no hay lotes con procedencia. Así que «quitar sólo lo regalado y nunca lo
 * comprado» NO es implementable sin rediseñar el monedero, y este débito toca el
 * saldo TOTAL. Se dice en vez de fingir un filtro que no existe.
 *
 * Las salvaguardas que sí hay: motivo obligatorio, `AuditLog` con el actor, y
 * suelo en cero — el saldo nunca queda negativo (ver el servicio).
 *
 * Ver docs/diseno-ficha-usuario.md §3.3 y §7 (D-2).
 */
export class BalanceDebitDto {
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
