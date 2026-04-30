import { Controller, Get, Query } from '@nestjs/common';

import { Public } from '../../common/decorators/public.decorator';
import { BannersService } from './banners.service';

@Controller({ path: '', version: '1' })
export class BannersController {
  constructor(private readonly banners: BannersService) {}

  /** Active home-screen carousel for the user's region. */
  @Public()
  @Get('banners/home')
  async listHome(@Query('country') country?: string) {
    const items = await this.banners.listActiveHome(country);
    return { items };
  }

  /**
   * Currently-featured splash banner — the mobile app calls this in the
   * background, caches the URL, and uses it on the next cold launch.
   * Returns `{ banner: null }` when nothing is featured (mobile keeps
   * using the default splash in that case).
   */
  @Public()
  @Get('splash/featured')
  async featuredSplash() {
    const banner = await this.banners.getFeaturedSplash();
    return { banner };
  }
}
