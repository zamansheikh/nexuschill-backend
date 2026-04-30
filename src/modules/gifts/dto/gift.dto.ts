import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { GiftCategory } from '../schemas/gift.schema';
import { GiftContext } from '../schemas/gift-event.schema';

class LocalizedDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  en!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  bn?: string;
}

export class CreateGiftDto {
  @ValidateNested()
  @Type(() => LocalizedDto)
  name!: LocalizedDto;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{2,30}$/)
  code!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedDto)
  description?: LocalizedDto;

  @IsEnum(GiftCategory)
  category!: GiftCategory;

  @IsInt()
  @Min(1)
  priceCoins!: number;

  @IsInt()
  @Min(0)
  beanReward!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  animationUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  soundUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(500)
  durationMs?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  vipOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  svipOnly?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  countries?: string[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @ArrayMaxSize(10)
  comboMultipliers?: number[];

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}

export class UpdateGiftDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedDto)
  name?: LocalizedDto;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{2,30}$/)
  code?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedDto)
  description?: LocalizedDto;

  @IsOptional()
  @IsEnum(GiftCategory)
  category?: GiftCategory;

  @IsOptional()
  @IsInt()
  @Min(1)
  priceCoins?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  beanReward?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  animationUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  soundUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(500)
  durationMs?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  vipOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  svipOnly?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  countries?: string[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @ArrayMaxSize(10)
  comboMultipliers?: number[];

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}

export class SendGiftDto {
  @IsMongoId()
  giftId!: string;

  @IsMongoId()
  receiverId!: string;

  @IsInt()
  @Min(1)
  count!: number;

  @IsOptional()
  @IsEnum(GiftContext)
  contextType?: GiftContext;

  @IsOptional()
  @IsMongoId()
  contextId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;

  /** Client-supplied unique key. Same key returns the original event (no double-spend). */
  @IsString()
  @MaxLength(80)
  idempotencyKey!: string;
}
