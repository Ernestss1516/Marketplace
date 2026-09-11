import { IsOptional, IsString } from 'class-validator';

/**
 * COOKIES RÁFAGA 2 — lo que la pantalla de admin puede cambiar.
 *
 * **ESTA CLASE ES LA FRONTERA**, y por eso conviene leerla entera: son siete campos de
 * TEXTO y nada más. No hay —ni puede haber— un `bloquearTerceros`, un `mostrarBanner`,
 * un `categorias` ni un `ocultarRechazar`. La mecánica del consentimiento es legal y es
 * fija; lo único que cambia de una instancia a otra es cómo se cuenta.
 *
 * Todos opcionales porque la pantalla manda sólo lo que el admin tocó: obligar a
 * mandarlo todo haría que corregir una errata reescribiera también `version`, que es
 * justamente el campo que no debe moverse por accidente (D5 — subirlo re-pregunta a toda
 * la base de usuarios).
 *
 * Las reglas de longitud y contenido viven en el SERVICIO (`ConsentConfigService.validar`)
 * y no aquí: son reglas de negocio —una de ellas protege una obligación legal— y este
 * repo las quiere donde no se puedan esquivar llamando por otra vía.
 */
export class UpdateCookieConfigDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsString() acceptLabel?: string;
  @IsOptional() @IsString() rejectLabel?: string;
  @IsOptional() @IsString() moreLabel?: string;
  @IsOptional() @IsString() policyUrl?: string;
  @IsOptional() @IsString() version?: string;
}
