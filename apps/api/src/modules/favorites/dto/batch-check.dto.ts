import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

export class BatchCheckDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  listingIds!: string[];
}
