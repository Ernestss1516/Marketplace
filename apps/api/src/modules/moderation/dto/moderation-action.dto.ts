import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ModerationActionDto {
  @ApiPropertyOptional({ description: 'Razón de la acción (queda en AuditLog)' })
  @IsString()
  @IsOptional()
  reason?: string;
}
