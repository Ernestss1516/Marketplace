import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * FLUJO (b) — la administración inicia un hilo con un usuario concreto.
 *
 * `userId` es el DESTINATARIO (el dueño del hilo), no quien lo abre: `openedById`
 * lo pone el servidor con el actor del JWT. El usuario se elige en el frontend
 * con `GET /users/search`, que ya existe.
 *
 * NO declara `origin` (lo fija el servicio a ADMIN), ni `status`, ni
 * `assignedToId`, ni `linkedLabel`, ni `reportId` (eso es el flujo c, que tiene
 * su propia ruta). Y NO declara `internal`: la escritura de notas internas sigue
 * aplazada (§14.3) también para el staff en R3.
 */
export class CreateAdminTicketDto {
  @ApiProperty({ description: 'Usuario destinatario del hilo' })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({ minLength: 3, maxLength: 150 })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(150)
  subject!: string;

  @ApiProperty({ description: 'Primer mensaje del hilo (side STAFF)', minLength: 1, maxLength: 5000 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  @ApiPropertyOptional({ description: 'Motivo (ContactReason con scope TICKET o BOTH)' })
  @IsOptional()
  @IsString()
  topicId?: string;

  // Enlaces opcionales. Se validan contra el USUARIO DESTINATARIO, no contra el
  // agente: `linkedLabel` se le sirve a él, así que enlazar aquí una entidad de
  // un tercero le filtraría ese dato.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  listingId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reviewId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  invoiceId?: string;
}
