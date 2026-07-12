import { IsEnum } from 'class-validator';
import { ContactEstado } from '@prisma/client';

export class UpdateContactEstadoDto {
  @IsEnum(ContactEstado)
  estado!: ContactEstado;
}
