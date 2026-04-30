import { Controller, Get, Query } from '@nestjs/common';

import { Public } from '../../common/decorators/public.decorator';
import { StoreCategory } from './schemas/store-listing.schema';
import { StoreService } from './store.service';

/**
 * Public-ish read-only catalog. Requires no auth — store browsing is open
 * to anyone on the app, purchase requires login (handled by the future
 * /me/store/purchase endpoint).
 */
@Controller({ path: 'store', version: '1' })
export class StoreController {
  constructor(private readonly store: StoreService) {}

  @Public()
  @Get('listings')
  async list(
    @Query('category') category?: StoreCategory,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.store.listForUsers({ category, page, limit });
  }
}
