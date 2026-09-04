import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject, IsString, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TODOS_LOS_MODELOS } from '../estilo.constants';

/**
 * Un color, en cualquiera de las dos formas que el sistema entiende: el triplete de
 * `globals.css` (`"221.2 83.2% 53.3%"`) o el hexadecimal que devuelve un selector de
 * color (`"#2563eb"`).
 *
 * SE VALIDA LA FORMA AQUÍ Y EL CONTRASTE EN EL SERVICIO, y son dos cosas distintas:
 * `"morado"` es basura y se rechaza con un 400 de DTO; `"#808080"` es un color
 * perfectamente válido que resulta ilegible como fondo de texto, y eso es un 422 con
 * el ratio medido. Mezclarlos daría un mensaje que no ayuda en ninguno de los dos
 * casos.
 */
const FORMA_COLOR = /^(#?[0-9a-fA-F]{6}|-?[\d.]+\s+[\d.]+%\s+[\d.]+%)$/;

export class ColoresDto {
  @ApiProperty({ example: '221.2 83.2% 53.3%', description: 'Triplete HSL o hexadecimal' })
  @IsString()
  @Matches(FORMA_COLOR, { message: 'primary debe ser un triplete HSL o un hexadecimal' })
  primary!: string;

  @ApiProperty({ example: '210 40% 96.1%' })
  @IsString()
  @Matches(FORMA_COLOR, { message: 'secondary debe ser un triplete HSL o un hexadecimal' })
  secondary!: string;

  @ApiProperty({ example: '210 40% 96.1%' })
  @IsString()
  @Matches(FORMA_COLOR, { message: 'accent debe ser un triplete HSL o un hexadecimal' })
  accent!: string;

  @ApiProperty({
    example: '210 40% 96.1%',
    description:
      'El gris base. De él salen fondo, superficies, trazo y texto — ver la rampa del modelo.',
  })
  @IsString()
  @Matches(FORMA_COLOR, { message: 'neutral debe ser un triplete HSL o un hexadecimal' })
  neutral!: string;
}

/**
 * ⚠ AQUÍ NO HAY NINGÚN `-foreground`, Y ES LA DECISIÓN DE ACCESIBILIDAD DEL SISTEMA.
 *
 * El admin aporta CUATRO colores y ninguno más. Qué color de letra va encima de cada
 * uno lo decide la máquina por contraste (`mejorTextoSobre`), porque es exactamente la
 * palanca con la que se rompe la accesibilidad sin darse cuenta: elegir «azul de
 * marca» es una decisión de marca; elegir la letra que va encima es una medición.
 *
 * Que no exista el campo es más fuerte que validarlo: no se puede enviar lo que el
 * tipo no admite.
 */
export class SetEstiloDto {
  /**
   * ⚠ SE VALIDA CONTRA `TODOS_LOS_MODELOS` Y NO CONTRA EL CATÁLOGO, y la diferencia es
   * de una sola entrada: el modelo de prueba de E6 (`modelo-prueba-contraluz`).
   *
   * `catalogo()` sigue sirviendo sólo `MODELOS`, así que la pantalla de admin no lo
   * ofrece en ninguna parte — no es «un modelo escondido a medias», es uno que existe y
   * no se propone. Lo que esta línea permite es que el TEST DE INVARIANCIA DEL HTML
   * (§10.5) lo active por la VÍA REAL: el mismo PUT que usaría un admin, con su
   * validación AA, su `AuditLog` y su `revalidateTag`. La alternativa era escribir la
   * fila a mano desde el test, y entonces el test probaría un camino que producción no
   * usa — justo lo que hace que un verde no signifique nada.
   *
   * No abre ningún riesgo: el modelo de prueba pasa la misma validación de contraste que
   * los demás (`contraste-modelos.spec.ts` lo mide igual), sólo un ADMIN puede llegar
   * aquí, y se deshace con el `DELETE` de al lado.
   */
  @ApiProperty({ enum: TODOS_LOS_MODELOS.map((m) => m.id), example: 'modelo-0' })
  @IsString()
  @IsIn(TODOS_LOS_MODELOS.map((m) => m.id), { message: 'modelo no reconocido' })
  modelo!: string;

  @ApiProperty({ example: '1' })
  @IsString()
  version!: string;

  @ApiProperty({ type: ColoresDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ColoresDto)
  colores!: ColoresDto;
}
