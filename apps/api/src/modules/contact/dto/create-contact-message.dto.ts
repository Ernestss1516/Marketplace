import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateContactMessageDto {
  /** RC.2 — FK a ContactReason (ya no un enum). Existencia y `activo:true`
   * se validan en el service (ContactService.submit), no aquí: requiere
   * consulta a BD, fuera del alcance de class-validator. */
  @IsString()
  motivoId!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  telefono?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  mensaje!: string;

  /** Honeypot (RC.1) — oculto por CSS en el formulario, NUNCA type="hidden".
   * Un humano nunca lo rellena; debe declararse aquí para pasar el
   * whitelist:true del ValidationPipe global, pero su contenido no se valida
   * (cualquier valor no vacío dispara el descarte silencioso en el service). */
  @IsOptional()
  @IsString()
  empresa?: string;

  /** Token firmado emitido por GET /contacto/token — ver ContactTimeTrapService. */
  @IsString()
  timeTrapToken!: string;
}
