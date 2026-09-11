import { ArrayUnique, IsArray, IsIn, IsString, MaxLength } from 'class-validator';
import { ConsentAction } from '@prisma/client';
import { CONSENT_CATEGORIES } from '../consent.constants';

/**
 * COOKIES RÁFAGA 1 — la decisión que el navegador comunica.
 *
 * `action` se acepta del cliente en vez de derivarse de `categories` porque un GRANTED
 * con la lista vacía y un REJECTED serían indistinguibles, y son dos hechos jurídicos
 * distintos: uno dice «acepté nada», el otro «rechacé». La prueba tiene que poder
 * distinguirlos.
 *
 * `categories` va validada contra la lista cerrada: una categoría inventada no puede
 * entrar en la tabla de la prueba, ni siquiera si alguien llama al endpoint a mano.
 */
export class RecordConsentDto {
  @IsIn(Object.values(ConsentAction))
  action!: ConsentAction;

  @IsArray()
  @ArrayUnique()
  @IsIn(CONSENT_CATEGORIES as readonly string[], { each: true })
  categories!: string[];

  @IsString()
  @MaxLength(32)
  policyVersion!: string;
}
