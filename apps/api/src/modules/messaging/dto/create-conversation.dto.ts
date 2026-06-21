import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateConversationDto {
  @ApiProperty({ description: 'ID del anuncio sobre el que se inicia la conversación' })
  @IsString()
  @IsNotEmpty()
  listingId!: string;

  @ApiProperty({ description: 'Primer mensaje al vendedor', minLength: 1, maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
}
