import { Logger, UseFilters } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { JwtPayload } from '../auth/services/token.service';
import { RealtimeService } from './realtime.service';

/**
 * The single Socket.IO endpoint for the app. Lives at the namespace
 * `/realtime`. Every authenticated user keeps one connection open while
 * the app is in the foreground; the connection is suspended when the OS
 * background-kills the socket and resumed via `resume` events using the
 * sequence numbers persisted by RealtimeService.
 *
 * Authentication: the JWT access token is passed on the handshake either
 * via `auth.token` (preferred) or `query.token`. Mismatched/expired tokens
 * are rejected synchronously — no anonymous connections allowed.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ============== Lifecycle ==============

  afterInit(server: Server) {
    this.realtime.attachServer(server);
    this.logger.log('Realtime gateway initialized at /realtime');
  }

  async handleConnection(socket: Socket) {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.query?.token as string | undefined);
      if (!token) {
        this.disconnectWithError(socket, 'NO_TOKEN', 'Missing auth token');
        return;
      }
      const secret = this.config.get<string>('jwt.accessSecret') ?? '';
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret,
      });
      // Stash identity on the socket for downstream handlers.
      socket.data.userId = payload.sub;

      // Every authenticated user is auto-joined to `global` so banner-style
      // events (rocket, announcements) reach them without an explicit
      // subscribe step.
      await socket.join('global');

      this.logger.debug(`Connected: user=${payload.sub} sid=${socket.id}`);
    } catch (err: any) {
      this.disconnectWithError(
        socket,
        'INVALID_TOKEN',
        err?.message ?? 'Token verification failed',
      );
    }
  }

  handleDisconnect(socket: Socket) {
    if (socket.data?.userId) {
      this.logger.debug(`Disconnected: user=${socket.data.userId} sid=${socket.id}`);
    }
  }

  // ============== Client → server messages ==============

  /**
   * Join a room channel. Mobile calls this on entering a room; the room id
   * is the Mongo _id of the room (matches what the REST `enter` endpoint
   * returned). We don't re-verify presence here — the REST `enter` endpoint
   * already did that; sockets that subscribe without first calling enter
   * will simply receive nothing actionable since the events that matter
   * (gifts, kicks) come *to* them as the target.
   */
  @SubscribeMessage('subscribe')
  async onSubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { roomId?: string },
  ) {
    if (!socket.data.userId) {
      throw new WsException({ code: 'UNAUTHENTICATED', message: 'Not authenticated' });
    }
    const roomId = (body?.roomId ?? '').trim();
    if (!roomId) return { ok: false, error: 'roomId required' };
    await socket.join(`room:${roomId}`);
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe')
  async onUnsubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { roomId?: string },
  ) {
    const roomId = (body?.roomId ?? '').trim();
    if (!roomId) return { ok: false };
    await socket.leave(`room:${roomId}`);
    return { ok: true };
  }

  /**
   * Replay missed events. Body lists every scope the client cares about
   * along with the last sequence it saw on that scope. Responds with the
   * gap (or a `truncated: true` flag asking the client to do a fresh
   * snapshot fetch).
   */
  @SubscribeMessage('resume')
  async onResume(
    @ConnectedSocket() socket: Socket,
    @MessageBody()
    body: { cursors?: Array<{ scope: string; lastSeq: number }> },
  ) {
    if (!socket.data.userId) {
      throw new WsException({ code: 'UNAUTHENTICATED', message: 'Not authenticated' });
    }
    const cursors = body?.cursors ?? [];
    const results = await Promise.all(
      cursors.map(async (c) => {
        const { events, truncated } = await this.realtime.replay(
          c.scope,
          c.lastSeq ?? 0,
        );
        return { scope: c.scope, events, truncated };
      }),
    );
    return { ok: true, scopes: results };
  }

  /** Lightweight liveness probe — clients ping every ~30s in foreground
   *  to keep idle middleboxes from killing the connection. */
  @SubscribeMessage('ping')
  onPing() {
    return { pong: Date.now() };
  }

  // ============== helpers ==============

  private disconnectWithError(socket: Socket, code: string, message: string) {
    this.logger.warn(`Rejecting connection sid=${socket.id}: ${code} (${message})`);
    socket.emit('error', { code, message });
    socket.disconnect(true);
  }
}
