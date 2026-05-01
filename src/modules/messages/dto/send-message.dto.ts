import { IsMongoId, IsString, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  /** Recipient userId (Mongo _id). */
  @IsMongoId()
  toUserId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text!: string;
}
