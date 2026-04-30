import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CosmeticsModule } from '../cosmetics/cosmetics.module';
import { StoreListing, StoreListingSchema } from './schemas/store-listing.schema';
import { StoreAdminController } from './store-admin.controller';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: StoreListing.name, schema: StoreListingSchema }]),
    CosmeticsModule,
  ],
  controllers: [StoreAdminController, StoreController],
  providers: [StoreService],
  exports: [StoreService],
})
export class StoreModule {}
