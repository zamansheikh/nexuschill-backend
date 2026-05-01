import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

import { DevicePlatform } from '../schemas/device-token.schema';

export class RegisterTokenDto {
  @IsString()
  @MinLength(20)
  token!: string;

  @IsOptional()
  @IsEnum(DevicePlatform)
  platform?: DevicePlatform;

  @IsOptional()
  @IsString()
  locale?: string;
}

export class UnregisterTokenDto {
  @IsString()
  @MinLength(20)
  token!: string;
}
