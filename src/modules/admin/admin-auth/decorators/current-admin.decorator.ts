import { ExecutionContext, createParamDecorator } from '@nestjs/common';

import { AuthenticatedAdmin } from '../strategies/admin-jwt.strategy';

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedAdmin => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
