import { IsArray, IsOptional, IsString, IsUrl, Matches } from 'class-validator';
import { BlockDto, ValidBlocksArray } from './blocks/block.dto';

// type (POST|PAGE) deliberately has NO field here — it's immutable after creation.
// ValidationPipe({ forbidNonWhitelisted: true }) rejects any request that tries to
// send it (400), rather than silently ignoring it. Reclassifying a post as a page
// (or vice versa) would move it in/out of the feed and change its URL prefix out
// from under anyone who linked to it.
export class UpdatePostDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lowercase letters, numbers and hyphens only',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  excerpt?: string;

  @IsOptional()
  @ValidBlocksArray()
  blocks?: BlockDto[];

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  coverUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  metaTitle?: string;

  @IsOptional()
  @IsString()
  metaDescription?: string;
}
