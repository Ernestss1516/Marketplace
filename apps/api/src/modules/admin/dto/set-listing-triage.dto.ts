import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ListingTriage } from '@prisma/client';

/**
 * ETIQUETA INTERNA (P1) — el cambio MANUAL de la anotación del staff.
 *
 * LOS DOS EJES EN UN SOLO ENDPOINT, y cada uno opcional: el moderador puede
 * mover el triaje, poner o quitar la observación, o las dos cosas a la vez. Se
 * mandan juntos porque se editan juntos —son las dos insignias de la misma
 * cabecera— pero se guardan por separado: omitir uno NO lo pisa.
 *
 * NO ADMITE `EDITED`: ese valor afirma que ocurrió un hecho («el dueño cambió
 * esto después de que lo revisaran») y sólo el sistema puede saberlo. El DTO deja
 * pasar el enum entero por simplicidad de validación y el servicio lo rechaza con
 * un 400 que explica por qué — ver `isManualTriageTarget`.
 */
export class SetListingTriageDto {
  @IsOptional()
  @IsEnum(ListingTriage)
  triage?: ListingTriage;

  @IsOptional()
  @IsBoolean()
  watched?: boolean;
}
