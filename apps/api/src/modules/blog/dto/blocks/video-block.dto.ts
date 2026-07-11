import {
  IsIn,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { BaseBlockDto } from './base-block.dto';

const PROVIDERS = ['youtube', 'vimeo'] as const;
export type VideoProvider = (typeof PROVIDERS)[number];

// Formato de id por proveedor — YouTube: 11 caracteres URL-safe (base64-like);
// Vimeo: numérico. Nunca se guarda la URL cruda ni un iframe libre — el
// cliente parsea la URL pegada por el admin a {provider, videoId}, y el
// backend REVALIDA el formato aquí independientemente (nunca confía en el
// parseo del cliente). El renderizador construye el iframe controlado
// (youtube-nocookie.com/embed/{videoId} o player.vimeo.com/video/{videoId}).
const VIDEO_ID_PATTERNS: Record<VideoProvider, RegExp> = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
  vimeo: /^[0-9]{6,12}$/,
};

// Necesita leer el `provider` hermano para saber qué patrón aplicar a
// `videoId` — class-validator resuelve esto vía `args.object`, el idiom
// oficial para "un campo depende de otro del mismo objeto" (su propio
// ejemplo de referencia es un password-confirm). @ValidateIf apilado dos
// veces NO sirve aquí: sus condiciones se combinan con AND, así que con
// provider fijo en un único valor una de las dos siempre sería falsa y el
// decorador emparejado nunca correría.
@ValidatorConstraint({ name: 'isValidVideoId', async: false })
class IsValidVideoIdConstraint implements ValidatorConstraintInterface {
  validate(videoId: unknown, args: ValidationArguments): boolean {
    if (typeof videoId !== 'string') return false;
    const provider = (args.object as VideoBlockDto).provider;
    const pattern = VIDEO_ID_PATTERNS[provider];
    return pattern ? pattern.test(videoId) : false;
  }

  defaultMessage(): string {
    return 'videoId no tiene un formato válido para el provider indicado';
  }
}

function IsValidVideoId(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidVideoId',
      target: object.constructor,
      propertyName,
      options,
      validator: IsValidVideoIdConstraint,
    });
  };
}

export class VideoBlockDto extends BaseBlockDto {
  @IsIn(['video'])
  type!: 'video';

  @IsIn(PROVIDERS)
  provider!: VideoProvider;

  @IsValidVideoId()
  videoId!: string;
}
