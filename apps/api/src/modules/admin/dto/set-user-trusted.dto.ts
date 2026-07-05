import { IsBoolean } from 'class-validator';

export class SetUserTrustedDto {
  @IsBoolean()
  trusted!: boolean;
}
