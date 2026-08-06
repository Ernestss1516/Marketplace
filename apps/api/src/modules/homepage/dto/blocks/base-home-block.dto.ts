import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// id generado en CLIENTE (generateId(), apps/web/src/lib/utils.ts — crypto.randomUUID
// con fallback) y persistido tal cual: da React keys estables y permite
// reordenar/editar bloques sin bugs de índice. El backend solo valida que venga
// una cadena no vacía — nunca lo genera ni lo reescribe.
//
// Copia deliberada de BaseBlockDto del blog (modules/blog/dto/blocks/base-block.dto.ts):
// mismo contrato, clase propia. Compartirla acoplaría los dos motores por el
// discriminador de class-transformer, que es exactamente lo que el diseño §0
// evita — ver docs/diseno-portada.md §2.4.
export abstract class BaseHomeBlockDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  id!: string;
}
