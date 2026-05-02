import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { LuckyBagDistributionMode } from '../schemas/lucky-bag.schema';

export class CreateLuckyBagDto {
  @IsMongoId()
  roomId!: string;

  /** Total coins to spread across the bag's slots. Server enforces a
   *  range; mobile sticks to the preset ladder admin configures. */
  @IsInt()
  @Min(1000)
  @Max(100_000_000)
  totalCoins!: number;

  @IsInt()
  @Min(1)
  @Max(100)
  slotCount!: number;

  /** Random or fixed-tier — defaults server-side to RANDOM. */
  @IsOptional()
  @IsEnum(LuckyBagDistributionMode)
  distributionMode?: LuckyBagDistributionMode;
}

class LuckyBagTierDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  slotCount!: number;

  /** Must equal slotCount and sum to 1.0 — service validates and rejects
   *  the whole patch with INVALID_TIER if either invariant is broken. */
  @IsArray()
  @ArrayMinSize(1)
  @IsNumber({}, { each: true })
  percentages!: number[];
}

export class UpdateLuckyBagConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  commissionRate?: number;

  @IsOptional()
  @IsBoolean()
  applyCommissionByDefault?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  coinPresets?: number[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LuckyBagTierDto)
  tiers?: LuckyBagTierDto[];
}
