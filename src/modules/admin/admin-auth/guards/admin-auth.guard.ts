import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Admin JWT guard. Unlike the user JwtAuthGuard, this does NOT honour the
 * global `@Public()` marker — `@Public()` exists solely to make the global
 * user guard skip these routes. Admin auth must still be enforced here.
 */
@Injectable()
export class AdminAuthGuard extends AuthGuard('admin-jwt') {}
