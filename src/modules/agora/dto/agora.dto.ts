import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum RtcRoleDto {
  PUBLISHER = 'publisher',
  SUBSCRIBER = 'subscriber',
}

const SECONDS_MIN = 60;
const SECONDS_MAX = 24 * 60 * 60; // 24 h cap — Agora SDK accepts up to 24 h

export class UpdateAgoraConfigDto {
  /** App ID is a 32-char hex; we only enforce length + alphanumeric here. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{16,64}$/, {
    message: 'appId must be a 16–64 char alphanumeric string',
  })
  appId?: string;

  /**
   * Pass empty string to leave certificate unchanged on update; the form
   * only sends the field when the user has actually re-typed it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  appCertificate?: string;

  @IsOptional()
  @IsInt()
  @Min(SECONDS_MIN)
  @Max(SECONDS_MAX)
  defaultExpireSeconds?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class RtcTokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9!#$%&()+\-:;<=.>?@[\]^_{|}~,\s]{1,64}$/, {
    message: 'channelName must be a valid Agora channel string',
  })
  channelName!: string;

  /** 0 = let Agora assign dynamically. */
  @IsOptional()
  @IsInt()
  @Min(0)
  uid?: number;

  @IsOptional()
  @IsEnum(RtcRoleDto)
  role?: RtcRoleDto;

  @IsOptional()
  @IsInt()
  @Min(SECONDS_MIN)
  @Max(SECONDS_MAX)
  expireSeconds?: number;
}

export class RtmTokenDto {
  /** RTM expects a string UID; we accept anything trimmed under 64 chars. */
  @IsString()
  @MaxLength(64)
  uid!: string;

  @IsOptional()
  @IsInt()
  @Min(SECONDS_MIN)
  @Max(SECONDS_MAX)
  expireSeconds?: number;
}
