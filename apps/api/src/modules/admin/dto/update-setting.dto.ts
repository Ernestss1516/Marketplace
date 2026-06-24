import { Allow } from 'class-validator';

// value can be any JSON-serializable type (string[], number, boolean).
// @Allow() keeps the field alive through whitelist:true without constraining its shape.
export class UpdateSettingDto {
  @Allow()
  value!: unknown;
}
