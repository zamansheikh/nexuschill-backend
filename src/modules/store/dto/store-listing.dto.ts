import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  Min,
} from 'class-validator';

import { StoreCategory } from '../schemas/store-listing.schema';

export class CreateStoreListingDto {
  @IsMongoId()
  cosmeticItemId!: string;

  @IsEnum(StoreCategory)
  category!: StoreCategory;

  @IsInt()
  @Min(1)
  priceCoins!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationDays?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

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
  giftable?: boolean;
}

export class UpdateStoreListingDto {
  @IsOptional()
  @IsEnum(StoreCategory)
  category?: StoreCategory;

  @IsOptional()
  @IsInt()
  @Min(1)
  priceCoins?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationDays?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

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
  giftable?: boolean;
}
