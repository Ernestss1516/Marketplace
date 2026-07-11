import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// id generado en cliente (generateId(), lib/utils.ts — crypto.randomUUID con
// fallback) y persistido tal cual: da React keys estables y permite
// reordenar/editar bloques sin bugs de índice. El backend solo valida que
// venga una cadena no vacía — nunca lo genera ni lo reescribe.
export abstract class BaseBlockDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  id!: string;
}
