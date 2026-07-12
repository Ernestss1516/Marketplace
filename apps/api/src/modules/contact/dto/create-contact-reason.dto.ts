import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateContactReasonDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nombre!: string;
}
