import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { HonorsAdminController } from './honors-admin.controller';
import { HonorsController } from './honors.controller';
import { HonorsService } from './honors.service';
import { HonorItem, HonorItemSchema } from './schemas/honor-item.schema';
import { UserHonor, UserHonorSchema } from './schemas/user-honor.schema';

/**
 * Standalone module — depends on no other module. Exports
 * `HonorsService` so the task / event hooks can call `awardByKey()`
 * without going through the admin controller.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HonorItem.name, schema: HonorItemSchema },
      { name: UserHonor.name, schema: UserHonorSchema },
    ]),
  ],
  controllers: [HonorsController, HonorsAdminController],
  providers: [HonorsService],
  exports: [HonorsService],
})
export class HonorsModule {}
