import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class GetUploadSignatureDto {
  /** Subfolder, e.g. "avatars", "moments", "rooms". */
  @IsString()
  @MaxLength(40)
  @Matches(/^[a-z0-9_-]+(\/[a-z0-9_-]+)*$/, {
    message: 'folder must be lowercase alphanumeric with optional / separators',
  })
  folder!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9_-]+$/)
  publicId?: string;
}
