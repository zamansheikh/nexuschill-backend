import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { MediaModule } from '../media/media.module';
import { HonorsAdminController } from './honors-admin.controller';
import { HonorsController } from './honors.controller';
import { HonorsService } from './honors.service';
import { HonorItem, HonorItemSchema } from './schemas/honor-item.schema';
import { UserHonor, UserHonorSchema } from './schemas/user-honor.schema';

/**
 * HonorsModule. Exports `HonorsService` so the task / event hooks
 * can call `awardByKey()` without going through the admin controller.
 *
 * `MediaModule` is imported for the icon upload endpoints (image +
 * SVGA) — same Cloudinary integration the cosmetics module uses,
 * one-way arrow with no cycle risk.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HonorItem.name, schema: HonorItemSchema },
      { name: UserHonor.name, schema: UserHonorSchema },
    ]),
    MediaModule,
  ],
  controllers: [HonorsController, HonorsAdminController],
  providers: [HonorsService],
  exports: [HonorsService],
})
export class HonorsModule {}
