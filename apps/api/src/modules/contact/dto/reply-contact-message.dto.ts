import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReplyContactMessageDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  asunto!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(5000)
  cuerpo!: string;
}
