import { IsInt, IsMongoId, Max, Min } from 'class-validator';

export class CreateLuckyBagDto {
  @IsMongoId()
  roomId!: string;

  /** Total coins to spread across the bag's slots. Server enforces a
   *  range; mobile sticks to the preset ladder (60K..600K in v1). */
  @IsInt()
  @Min(1000)
  @Max(100_000_000)
  totalCoins!: number;

  @IsInt()
  @Min(1)
  @Max(100)
  slotCount!: number;
}
