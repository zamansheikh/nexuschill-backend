import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WearHonorDto } from './dto/honors.dto';
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

  /**
   * Worn medals for any user — drives the profile hero-strip /
   * "wearing" preview. Public so unauthenticated profile views still
   * render the badges.
   */
  @Public()
  @Get('users/:userId/worn')
  async listWorn(@Param('userId') userId: string) {
    return this.honors.listWornForUser(userId);
  }
}

/**
 * Per-caller honor wall surface. Reads everything the user needs to
 * render the page — full catalog merged with what they own, what
 * they're wearing, and where they are on each tier — and lets them
 * toggle wear / unwear.
 */
@Controller({ path: 'me/honors', version: '1' })
@UseGuards(JwtAuthGuard)
export class MeHonorsController {
  constructor(private readonly honors: HonorsService) {}

  @Get()
  async myHonors(@CurrentUser() current: AuthenticatedUser) {
    return this.honors.listMyHonors(current.userId);
  }

  /**
   * Wear an owned medal in `body.slot` (0..9). Errors:
   *   • 400 INVALID_SLOT — slot out of range.
   *   • 404 HONOR_NOT_OWNED — caller doesn't hold this medal.
   */
  @HttpCode(HttpStatus.OK)
  @Post(':userHonorId/wear')
  async wear(
    @CurrentUser() current: AuthenticatedUser,
    @Param('userHonorId') userHonorId: string,
    @Body() dto: WearHonorDto,
  ) {
    const honor = await this.honors.wear(current.userId, userHonorId, dto.slot);
    return { honor };
  }

  /** Take the medal off the wall — idempotent. */
  @HttpCode(HttpStatus.OK)
  @Post(':userHonorId/unwear')
  async unwear(
    @CurrentUser() current: AuthenticatedUser,
    @Param('userHonorId') userHonorId: string,
  ) {
    const honor = await this.honors.unwear(current.userId, userHonorId);
    return { honor };
  }
}
