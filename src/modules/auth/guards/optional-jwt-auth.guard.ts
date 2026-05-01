import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * "Auth is allowed but not required" guard. Use on endpoints that
 * are reachable by anonymous users but render *richer* output when
 * the caller is logged in — the moments feed is the canonical
 * example: anyone can read it, but a logged-in viewer also gets
 * `likedByMe`/`myReaction` annotations.
 *
 * Behavior:
 *   • No Authorization header → request continues with `req.user = undefined`.
 *   • Valid JWT → request continues with `req.user` populated, exactly like
 *     [JwtAuthGuard].
 *   • Malformed / expired JWT → still allowed through with `req.user`
 *     undefined. We don't 401 for partial credentials on routes the
 *     caller never had to authenticate to in the first place.
 *
 * Why this exists: the global [JwtAuthGuard] short-circuits on
 * `@Public()` and never invokes the strategy, so `@CurrentUser()`
 * always reads `undefined` on public routes — even with a valid
 * token in the header. This guard always invokes the strategy
 * but tolerates absence/error.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Run the strategy, but never let a parse / validation failure
    // turn into a 401 — `handleRequest` below absorbs that.
    try {
      await super.canActivate(context);
    } catch (_) {
      // swallow
    }
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRequest<TUser = any>(_err: any, user: any): TUser {
    // Don't throw on missing user — return null so `@CurrentUser()`
    // resolves to undefined in the controller.
    return user ?? null;
  }
}
