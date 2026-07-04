import { IsString } from 'class-validator';

export class SocialLoginDto {
  @IsString()
  idToken!: string;
}
