import { IsNotEmpty, IsString } from 'class-validator';

export class AttributeUsageDto {
  @IsString()
  @IsNotEmpty()
  key!: string;
}
