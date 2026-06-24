import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  comment?: string;

  @ApiProperty({ description: 'ID del anuncio sobre el que se tuvo la conversación' })
  @IsString()
  listingId!: string;

  @ApiProperty({ description: 'ID del usuario que recibe la valoración' })
  @IsString()
  targetId!: string;
}
