import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { BannerLinkKind } from '../schemas/home-banner.schema';

export class CreateHomeBannerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  imageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  imagePublicId?: string;

  @IsOptional()
  @IsEnum(BannerLinkKind)
  linkKind?: BannerLinkKind;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkValue?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

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
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(60)
  countries?: string[];
}

export class UpdateHomeBannerDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  imagePublicId?: string;

  @IsOptional()
  @IsEnum(BannerLinkKind)
  linkKind?: BannerLinkKind;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkValue?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

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
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(60)
  countries?: string[];
}

export class CreateSplashBannerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  imageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  imagePublicId?: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateSplashBannerDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  imagePublicId?: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

// ---------- Room banners ----------

export class CreateRoomBannerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  imageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  imagePublicId?: string;

  @IsOptional()
  @IsEnum(BannerLinkKind)
  linkKind?: BannerLinkKind;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkValue?: string;

  /** 1 = top in-room stack, 2 = bottom. Mobile renders two simultaneous slots. */
  @IsOptional()
  @IsInt()
  slot?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

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
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(60)
  countries?: string[];
}

export class UpdateRoomBannerDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  imagePublicId?: string;

  @IsOptional()
  @IsEnum(BannerLinkKind)
  linkKind?: BannerLinkKind;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkValue?: string;

  @IsOptional()
  @IsInt()
  slot?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

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
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(60)
  countries?: string[];
}
