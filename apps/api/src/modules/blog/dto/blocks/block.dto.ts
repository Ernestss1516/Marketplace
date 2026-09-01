import { applyDecorators } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, ValidateNested } from 'class-validator';
import { BaseBlockDto } from './base-block.dto';
import { TextBlockDto } from './text-block.dto';
import { FaqBlockDto } from './faq-block.dto';
import { HubBlockDto } from './hub-block.dto';
import { ImageBlockDto } from './image-block.dto';
import { CtaBlockDto } from './cta-block.dto';
import { QuoteBlockDto } from './quote-block.dto';
import { VideoBlockDto } from './video-block.dto';
import { SeparatorBlockDto } from './separator-block.dto';
import { TableBlockDto } from './table-block.dto';
import { ImageTextBlockDto } from './image-text-block.dto';
import { StepsBlockDto } from './steps-block.dto';
import { ProfileBlockDto } from './profile-block.dto';
import { ListingsBlockDto } from './listings-block.dto';
import { VideoUploadBlockDto } from './video-upload-block.dto';

export type BlockDto =
  | TextBlockDto
  | FaqBlockDto
  | HubBlockDto
  | ImageBlockDto
  | CtaBlockDto
  | QuoteBlockDto
  | VideoBlockDto
  | SeparatorBlockDto
  | TableBlockDto
  | ImageTextBlockDto
  | StepsBlockDto
  | ProfileBlockDto
  | ListingsBlockDto
  | VideoUploadBlockDto;

// Máximo de bloques por post — guardarraíl contra payloads abusivos, no una
// limitación de producto (100 bloques es muchísimo más de lo que cualquier
// artículo/página real necesitaría).
const MAX_BLOCKS = 100;

// Único punto donde se declaran los 14 subtipos — si se añade un 15º bloque,
// solo hace falta tocar aquí (y su propio *-block.dto.ts), no en cada DTO que
// use `blocks`. Empaquetado con applyDecorators (@nestjs/common) para no
// duplicar este bloque de ~20 líneas en CreatePostDto Y UpdatePostDto.
export function ValidBlocksArray(): PropertyDecorator {
  return applyDecorators(
    IsArray(),
    ArrayMaxSize(MAX_BLOCKS),
    ValidateNested({ each: true }),
    Type(() => BaseBlockDto, {
      discriminator: {
        property: 'type',
        subTypes: [
          { value: TextBlockDto, name: 'text' },
          { value: FaqBlockDto, name: 'faq' },
          { value: HubBlockDto, name: 'hub' },
          { value: ImageBlockDto, name: 'image' },
          { value: CtaBlockDto, name: 'cta' },
          { value: QuoteBlockDto, name: 'quote' },
          { value: VideoBlockDto, name: 'video' },
          { value: SeparatorBlockDto, name: 'separator' },
          { value: TableBlockDto, name: 'table' },
          { value: ImageTextBlockDto, name: 'imageText' },
          { value: StepsBlockDto, name: 'steps' },
          { value: ProfileBlockDto, name: 'profile' },
          { value: ListingsBlockDto, name: 'listings' },
          // `videoUpload` (vídeo alojado por nosotros) convive con `video` (embed de
          // YouTube/Vimeo): son dos tipos distintos y el embed no se toca.
          { value: VideoUploadBlockDto, name: 'videoUpload' },
        ],
      },
      keepDiscriminatorProperty: true,
    }),
  ) as PropertyDecorator;
}
