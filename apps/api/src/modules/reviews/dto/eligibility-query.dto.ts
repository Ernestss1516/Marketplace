import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class EligibilityQueryDto {
  @ApiProperty({ description: 'ID del anuncio' })
  @IsString()
  listingId!: string;

  @ApiProperty({ description: 'ID del usuario a valorar' })
  @IsString()
  targetId!: string;
}
