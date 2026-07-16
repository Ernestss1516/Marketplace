import { IsString, MaxLength, MinLength } from 'class-validator';

export class UserSearchQueryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  q!: string;
}
