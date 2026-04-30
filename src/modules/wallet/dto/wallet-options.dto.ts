import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateRechargePackageDto {
  @IsInt()
  @Min(1)
  coins!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bonusCoins?: number;

  @IsInt()
  @Min(0)
  priceAmount!: number;

  @IsOptional()
  @IsString()
  @Length(2, 6)
  priceCurrency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  badgeText?: string;

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
}

export class UpdateRechargePackageDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  coins?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bonusCoins?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceAmount?: number;

  @IsOptional()
  @IsString()
  @Length(2, 6)
  priceCurrency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  badgeText?: string;

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
}

export class CreateExchangeOptionDto {
  @IsInt()
  @Min(1)
  diamondsRequired!: number;

  @IsInt()
  @Min(1)
  coinsAwarded!: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateExchangeOptionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  diamondsRequired?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  coinsAwarded?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ExchangeDiamondsDto {
  @IsMongoId()
  optionId!: string;

  @IsString()
  @MaxLength(80)
  idempotencyKey!: string;
}
