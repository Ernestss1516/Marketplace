import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * COOKIES RÁFAGA 2 — el id que el navegador guarda en su cookie y que une la decisión
 * anónima con la cuenta que acaba de entrar.
 *
 * Se valida la FORMA (un cuid: letras y números, sin separadores) antes de que llegue a
 * la consulta. No es defensa contra inyección —Prisma parametriza— sino contra ruido:
 * una cookie manipulada no debe convertirse en una búsqueda con cualquier cosa dentro.
 */
export class LinkConsentDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9]+$/i, { message: 'consentRecordId no tiene la forma de un identificador válido.' })
  consentRecordId!: string;
}
