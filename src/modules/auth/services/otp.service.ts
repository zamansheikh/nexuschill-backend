import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';

import { RedisService } from '../../../redis/redis.service';

interface OtpPayload {
  code: string;
  attempts: number;
  createdAt: number;
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private otpKey(phone: string) {
    return `otp:phone:${phone}`;
  }
  private cooldownKey(phone: string) {
    return `otp:cooldown:${phone}`;
  }

  async send(phone: string): Promise<{ cooldownSeconds: number }> {
    const cooldownKey = this.cooldownKey(phone);
    const existingCooldown = await this.redis.ttl(cooldownKey);
    if (existingCooldown > 0) {
      throw new HttpException(
        {
          code: 'OTP_COOLDOWN',
          message: `Please wait ${existingCooldown} seconds before requesting another code`,
          details: { cooldownSeconds: existingCooldown },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const length = this.config.get<number>('otp.length', 6);
    const expiry = this.config.get<number>('otp.expirySeconds', 300);
    const cooldown = this.config.get<number>('otp.resendCooldownSeconds', 60);

    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    const code = randomInt(min, max + 1).toString();

    const payload: OtpPayload = { code, attempts: 0, createdAt: Date.now() };
    await this.redis.set(this.otpKey(phone), JSON.stringify(payload), expiry);
    await this.redis.set(cooldownKey, '1', cooldown);

    await this.deliver(phone, code);

    return { cooldownSeconds: cooldown };
  }

  async verify(phone: string, code: string): Promise<boolean> {
    const key = this.otpKey(phone);
    const raw = await this.redis.get(key);
    if (!raw) {
      throw new UnauthorizedException({
        code: 'OTP_NOT_FOUND',
        message: 'No OTP found or it has expired. Please request a new one.',
      });
    }

    const payload: OtpPayload = JSON.parse(raw);
    const maxAttempts = this.config.get<number>('otp.maxAttempts', 5);

    if (payload.attempts >= maxAttempts) {
      await this.redis.del(key);
      throw new UnauthorizedException({
        code: 'OTP_MAX_ATTEMPTS',
        message: 'Too many invalid attempts. Please request a new OTP.',
      });
    }

    if (payload.code !== code) {
      payload.attempts += 1;
      const ttl = await this.redis.ttl(key);
      await this.redis.set(key, JSON.stringify(payload), Math.max(ttl, 1));
      throw new UnauthorizedException({
        code: 'OTP_INVALID',
        message: 'Invalid OTP',
        details: { attemptsLeft: maxAttempts - payload.attempts },
      });
    }

    await this.redis.del(key);
    return true;
  }

  private async deliver(phone: string, code: string) {
    const provider = this.config.get<string>('sms.provider', 'stub');
    if (provider === 'stub') {
      this.logger.warn(`[DEV] OTP for ${phone}: ${code}`);
      return;
    }
    // TODO: integrate Twilio / local aggregator here
    throw new BadRequestException(`SMS provider "${provider}" is not yet integrated`);
  }
}
