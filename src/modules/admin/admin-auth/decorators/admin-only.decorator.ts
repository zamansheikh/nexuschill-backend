import { UseGuards, applyDecorators } from '@nestjs/common';

import { Public } from '../../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';

/**
 * Use on admin-only controllers/methods.
 * - `@Public()` bypasses the global user-JWT guard
 * - `AdminAuthGuard` requires a valid admin JWT
 * - `PermissionsGuard` enforces @RequirePermissions / @RequireAnyPermission (no-op if none set)
 */
export const AdminOnly = () =>
  applyDecorators(Public(), UseGuards(AdminAuthGuard, PermissionsGuard));
