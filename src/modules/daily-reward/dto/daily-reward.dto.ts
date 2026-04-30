import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { RewardKind } from '../schemas/daily-reward-config.schema';

class DailyRewardItemDto {
  @IsEnum(RewardKind)
  kind!: RewardKind;

  @IsOptional()
  @IsInt()
  @Min(0)
  coinAmount?: number;

  @IsOptional()
  @IsMongoId()
  cosmeticItemId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  cosmeticDurationDays?: number;
}

class DailyRewardDayDto {
  @IsInt()
  @Min(1)
  @Max(7)
  day!: number;

  @ValidateNested({ each: true })
  @Type(() => DailyRewardItemDto)
  @IsArray()
  @ArrayMaxSize(8)
  rewards!: DailyRewardItemDto[];

  @IsOptional()
  @IsBoolean()
  isBigReward?: boolean;
}

export class UpsertDailyRewardConfigDto {
  @ValidateNested({ each: true })
  @Type(() => DailyRewardDayDto)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  days!: DailyRewardDayDto[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
