import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import {
  NotificationKind,
  NotificationLinkKind,
} from '../schemas/notification.schema';

class TargetSpec {
  /** Audience selector. `all` ignores the userIds list; `users` requires
   *  it. */
  @IsIn(['all', 'users'])
  type!: 'all' | 'users';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @IsMongoId({ each: true })
  userIds?: string[];
}

/** Request body for `POST /admin/notifications/push`. Same vocabulary
 *  as the in-app Notification (kind, linkKind, linkValue), plus a
 *  target spec so the admin can pick the audience. */
export class AdminPushNotificationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsEnum(NotificationKind)
  kind?: NotificationKind;

  @IsOptional()
  @IsEnum(NotificationLinkKind)
  linkKind?: NotificationLinkKind;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkValue?: string;

  @ValidateNested()
  @Type(() => TargetSpec)
  target!: TargetSpec;
}
