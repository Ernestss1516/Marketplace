import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtUser } from '../../modules/auth/auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser =>
    ctx.switchToHttp().getRequest<{ user: JwtUser }>().user,
);
