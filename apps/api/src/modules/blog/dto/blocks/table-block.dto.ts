import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { BaseBlockDto } from './base-block.dto';

const MAX_ROWS = 200;
const MAX_CELL_LENGTH = 500;

// class-validator no anida limpiamente "array de array de string" con
// @ValidateNested (eso espera instancias de clase, no primitivos) — un
// validador ad-hoc cubre la FORMA (es array de arrays de strings, dentro de
// límites de tamaño). La regla cruzada "cada fila tiene el mismo nº de
// columnas que headers" NO vive aquí (depende del campo hermano `headers` Y
// es una regla de negocio, no de forma) — vive en
// BlogService.assertTableBlockValid, mismo estilo que
// Post.assertFooterFieldsAllowed / FooterService.assertItemDestination.
function IsTableRows(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isTableRows',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          if (!Array.isArray(value) || value.length > MAX_ROWS) return false;
          return value.every(
            (row) =>
              Array.isArray(row) &&
              row.every((cell) => typeof cell === 'string' && cell.length <= MAX_CELL_LENGTH),
          );
        },
        defaultMessage(): string {
          return `rows debe ser un array de arrays de string (máx. ${MAX_ROWS} filas, celdas de hasta ${MAX_CELL_LENGTH} caracteres)`;
        },
      },
    });
  };
}

export class TableBlockDto extends BaseBlockDto {
  @IsIn(['table'])
  type!: 'table';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  headers!: string[];

  @IsTableRows()
  rows!: string[][];
}
