import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

import { Currency, TxnDirection } from '../schemas/transaction.schema';

export class AdjustBalanceDto {
  @IsEnum(Currency)
  currency!: Currency;

  @IsEnum(TxnDirection)
  direction!: TxnDirection;

  @IsInt()
  @Min(1)
  amount!: number;

  @IsString()
  @MaxLength(500)
  reason!: string;

  /** Optional client-supplied idempotency key. If omitted, server generates one. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  idempotencyKey?: string;
}

export class FreezeWalletDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class CreditCoinsDto {
  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsString()
  @MaxLength(80)
  idempotencyKey!: string;
}

export class MintCoinsDto {
  @IsInt()
  @Min(1)
  amount!: number;

  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  idempotencyKey?: string;
}
