import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Reasignación de un ticket a otro agente. Que el destinatario sea realmente
 * staff (ADMIN o MODERATOR) lo comprueba el servicio — requiere consulta a BD,
 * fuera del alcance de class-validator (mismo reparto que `topicId`).
 */
export class ReassignTicketDto {
  @ApiProperty({ description: 'Agente (ADMIN o MODERATOR) al que se asigna el ticket' })
  @IsString()
  @IsNotEmpty()
  assignedToId!: string;
}
