import { Controller, Get, Param, Query } from '@nestjs/common';

import { Public } from '../../common/decorators/public.decorator';
import { HonorCategory } from './schemas/honor-item.schema';
import { HonorsService } from './honors.service';

/// User-facing read endpoints. The mobile app hits these to render
/// the honor catalog (browse all available honors) and the per-user
/// inventory grids on profiles.
@Controller({ path: 'honors', version: '1' })
export class HonorsController {
  constructor(private readonly honors: HonorsService) {}

  /** Public catalog browse — used by the in-app "All medals"
   *  surface. We hide inactive items by default. */
  @Public()
  @Get()
  async listCatalog(
    @Query('category') category?: HonorCategory,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.honors.listCatalog({
      category,
      search,
      active: true,
      page,
      limit,
    });
  }
}
