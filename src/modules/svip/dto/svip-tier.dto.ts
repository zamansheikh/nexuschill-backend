import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSvipTierDto {
  @IsInt()
  @Min(1)
  @Max(9)
  level!: number;

  @IsString()
  @MaxLength(40)
  name!: string;

  @IsInt()
  @Min(0)
  monthlyPointsRequired!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  coinReward?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  iconUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  iconPublicId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bannerUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  bannerPublicId?: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMaxSize(50)
  grantedItemIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  privileges?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateSvipTierDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyPointsRequired?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  coinReward?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  iconUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  iconPublicId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bannerUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  bannerPublicId?: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMaxSize(50)
  grantedItemIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  privileges?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
