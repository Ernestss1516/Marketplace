import { IsBoolean } from 'class-validator';

/** MODERACIÓN M4 — marcar (o desmarcar) a un vendedor para revisión previa. */
export class SetUserRequiresReviewDto {
  @IsBoolean()
  requiresReview!: boolean;
}
