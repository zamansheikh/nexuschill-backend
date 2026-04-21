import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { hasPermission } from '../../permissions.catalog';
import { AuthenticatedAdmin } from '../strategies/admin-jwt.strategy';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../decorators/require-permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredAll = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAny = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_ANY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if ((!requiredAll || requiredAll.length === 0) && (!requiredAny || requiredAny.length === 0)) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const admin: AuthenticatedAdmin | undefined = req.user;
    if (!admin || !Array.isArray(admin.permissions)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'No admin context found on request',
      });
    }

    const granted = admin.permissions;

    if (requiredAll && requiredAll.length > 0) {
      for (const perm of requiredAll) {
        if (!hasPermission(granted, perm)) {
          throw new ForbiddenException({
            code: 'PERMISSION_DENIED',
            message: `Missing required permission: ${perm}`,
            details: { required: perm },
          });
        }
      }
    }

    if (requiredAny && requiredAny.length > 0) {
      const ok = requiredAny.some((perm) => hasPermission(granted, perm));
      if (!ok) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: `Missing one of required permissions: ${requiredAny.join(', ')}`,
          details: { requiredAny },
        });
      }
    }

    return true;
  }
}
