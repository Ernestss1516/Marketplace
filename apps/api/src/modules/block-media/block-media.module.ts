import { Module } from '@nestjs/common';
import { BlockMediaController } from './block-media.controller';
import { BlockMediaService } from './block-media.service';

/**
 * VÍDEO DE BLOQUE V1 — la subida.
 *
 * SIN `imports`, y no es un olvido: lo único que necesita es `R2Service`, y `R2Module` es
 * `@Global`. Que este módulo no dependa de `BlogModule` ni de `HomepageModule` —sino al
 * revés, que ninguno de los dos dependa de él— es lo que le permite servir a los tres
 * contextos sin atarlos entre sí.
 */
@Module({
  controllers: [BlockMediaController],
  providers: [BlockMediaService],
  exports: [BlockMediaService],
})
export class BlockMediaModule {}
