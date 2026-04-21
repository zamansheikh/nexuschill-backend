import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { UserDocument, UserStatus } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { OtpService } from './services/otp.service';
import { TokenPair, TokenService } from './services/token.service';

interface AuthContext {
  userAgent?: string;
  ipAddress?: string;
}

interface AuthResult {
  user: UserDocument;
  tokens: TokenPair;
  isNewUser?: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly config: ConfigService,
  ) {}

  async registerEmail(params: {
    email: string;
    password: string;
    username?: string;
    displayName?: string;
    context?: AuthContext;
  }): Promise<AuthResult> {
    if (await this.users.isEmailTaken(params.email)) {
      throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Email already registered' });
    }
    if (params.username && (await this.users.isUsernameTaken(params.username))) {
      throw new ConflictException({ code: 'USERNAME_TAKEN', message: 'Username already taken' });
    }

    const rounds = this.config.get<number>('security.bcryptRounds', 12);
    const passwordHash = await bcrypt.hash(params.password, rounds);

    const user = await this.users.createWithEmail({
      email: params.email,
      passwordHash,
      username: params.username,
      displayName: params.displayName,
    });

    const tokens = await this.tokens.issueTokenPair(
      {
        sub: user._id.toString(),
        email: user.email,
        username: user.username,
      },
      params.context,
    );

    await this.users.markLogin(user._id.toString());
    return { user, tokens };
  }

  async loginEmail(params: { email: string; password: string; context?: AuthContext }): Promise<AuthResult> {
    const user = await this.users.findByEmail(params.email, true);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    this.assertActive(user);

    const matches = await bcrypt.compare(params.password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    const tokens = await this.tokens.issueTokenPair(
      {
        sub: user._id.toString(),
        email: user.email,
        username: user.username,
      },
      params.context,
    );

    await this.users.markLogin(user._id.toString());
    return { user, tokens };
  }

  async sendPhoneOtp(phone: string): Promise<{ cooldownSeconds: number }> {
    return this.otp.send(phone);
  }

  async verifyPhoneOtp(params: {
    phone: string;
    otp: string;
    username?: string;
    context?: AuthContext;
  }): Promise<AuthResult> {
    await this.otp.verify(params.phone, params.otp);

    let user = await this.users.findByPhone(params.phone);
    let isNewUser = false;

    if (!user) {
      if (params.username && (await this.users.isUsernameTaken(params.username))) {
        throw new ConflictException({ code: 'USERNAME_TAKEN', message: 'Username already taken' });
      }
      user = await this.users.createWithPhone({
        phone: params.phone,
        username: params.username,
      });
      isNewUser = true;
    }

    this.assertActive(user);

    const tokens = await this.tokens.issueTokenPair(
      {
        sub: user._id.toString(),
        phone: user.phone,
        username: user.username,
      },
      params.context,
    );

    await this.users.markLogin(user._id.toString());
    return { user, tokens, isNewUser };
  }

  async refresh(refreshToken: string, context?: AuthContext): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken, context);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revoke(refreshToken);
  }

  private assertActive(user: UserDocument) {
    if (user.status === UserStatus.BANNED) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_BANNED',
        message: 'This account has been banned',
      });
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account is temporarily suspended',
      });
    }
    if (user.status === UserStatus.DELETED) {
      throw new BadRequestException({
        code: 'ACCOUNT_DELETED',
        message: 'This account has been deleted',
      });
    }
  }
}
