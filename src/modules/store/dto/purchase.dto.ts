import { IsInt, IsMongoId, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class PurchaseListingDto {
  @IsMongoId()
  listingId!: string;

  /** Client-supplied unique key. Same key = same outcome (idempotent). */
  @IsString()
  @MaxLength(80)
  idempotencyKey!: string;
}

export class GiftListingDto {
  @IsMongoId()
  listingId!: string;

  /**
   * Receiver — by Mongo ObjectId OR by 7-digit numericId. Mobile UI
   * typically only knows the numericId since that's what users see.
   */
  @IsOptional()
  @IsMongoId()
  receiverId?: string;

  @IsOptional()
  @IsInt()
  @Min(1_000_000)
  receiverNumericId?: number;

  @IsString()
  @MaxLength(80)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;
}
