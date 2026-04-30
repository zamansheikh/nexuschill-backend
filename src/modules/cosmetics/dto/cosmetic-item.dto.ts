import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { CosmeticAssetType, CosmeticType } from '../schemas/cosmetic-item.schema';

class LocalizedDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  en!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bn?: string;
}

export class CreateCosmeticItemDto {
  @ValidateNested()
  @Type(() => LocalizedDto)
  name!: LocalizedDto;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{2,40}$/)
  code!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedDto)
  description?: LocalizedDto;

  @IsEnum(CosmeticType)
  type!: CosmeticType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  previewUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  previewPublicId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  assetUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  assetPublicId?: string;

  @IsOptional()
  @IsEnum(CosmeticAssetType)
  assetType?: CosmeticAssetType;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rarity?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateCosmeticItemDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedDto)
  name?: LocalizedDto;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{2,40}$/)
  code?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedDto)
  description?: LocalizedDto;

  @IsOptional()
  @IsEnum(CosmeticType)
  type?: CosmeticType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  previewUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  previewPublicId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  assetUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  assetPublicId?: string;

  @IsOptional()
  @IsEnum(CosmeticAssetType)
  assetType?: CosmeticAssetType;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rarity?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
