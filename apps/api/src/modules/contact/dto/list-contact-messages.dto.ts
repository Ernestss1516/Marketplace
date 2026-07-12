import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ContactEstado } from '@prisma/client';

export class ListContactMessagesDto {
  @IsOptional()
  @IsEnum(ContactEstado)
  estado?: ContactEstado;

  @IsOptional()
  @IsString()
  motivoId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  perPage?: number = 25;
}
