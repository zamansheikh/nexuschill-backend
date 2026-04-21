import { IsBoolean, IsEnum, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { HostTier } from '../../../users/schemas/user.schema';

export class BanUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class ToggleHostDto {
  @IsBoolean()
  isHost!: boolean;

  @IsOptional()
  @IsEnum(HostTier)
  tier?: HostTier;

  @IsOptional()
  @IsMongoId()
  agencyId?: string;
}
