import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions_all';
export const PERMISSIONS_ANY_KEY = 'required_permissions_any';

/** Require ALL listed permissions. */
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS_KEY, perms);

/** Require AT LEAST ONE of the listed permissions. */
export const RequireAnyPermission = (...perms: string[]) => SetMetadata(PERMISSIONS_ANY_KEY, perms);
