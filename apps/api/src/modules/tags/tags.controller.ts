import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TagsService } from './tags.service';
import { SuggestTagsDto } from './dto/suggest-tags.dto';

/**
 * B4 — sugerencias del buscador de portada.
 *
 * Los endpoints de tags POR CATEGORÍA viven en `CategoriesController`
 * (`GET /categories/:slug/tags`) porque cuelgan de una categoría. Este no: la categoría
 * es un filtro OPCIONAL de la sugerencia, no su dueña — `/tags/suggest?q=die` sin
 * categoría es una consulta legítima al vocabulario global.
 *
 * Público a propósito: la portada la ve todo el mundo, con sesión o sin ella.
 */
@ApiTags('Tags')
@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get('suggest')
  @ApiOperation({
    summary: 'Sugerir etiquetas para el buscador',
    description:
      'Devuelve etiquetas que casan con el texto, acotadas a la categoría si se indica, ' +
      'con cuántos anuncios las llevan. Las de 0 anuncios se devuelven igual, al final: ' +
      'un vocabulario recién configurado tiene que poder sugerirse antes de que nadie ' +
      'haya publicado con él. Sin texto y con categoría, devuelve sus etiquetas por ' +
      'orden editorial (descubrimiento); sin texto y sin categoría, nada.',
  })
  @ApiOkResponse({ description: 'TagSuggestion[] — { id, slug, name, count }' })
  suggest(@Query() query: SuggestTagsDto) {
    return this.tagsService.suggestTags(query.q ?? '', query.category, query.limit ?? 8);
  }
}
