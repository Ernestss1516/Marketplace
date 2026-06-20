import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeiliSearch } from 'meilisearch';

@Injectable()
export class MeilisearchService {
  readonly client: MeiliSearch;

  constructor(private readonly config: ConfigService) {
    this.client = new MeiliSearch({
      host: this.config.getOrThrow<string>('meili.host'),
      apiKey: this.config.getOrThrow<string>('meili.masterKey'),
    });
  }
}
