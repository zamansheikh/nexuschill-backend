import {
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CosmeticsService } from './cosmetics.service';

/**
 * User-facing inventory endpoints. The admin counterpart is
 * CosmeticsAdminController.
 */
@Controller({ path: 'me/cosmetics', version: '1' })
@UseGuards(JwtAuthGuard)
export class CosmeticsController {
  constructor(private readonly cosmetics: CosmeticsService) {}

  @Get()
  async myCosmetics(@CurrentUser() current: AuthenticatedUser) {
    const items = await this.cosmetics.listUserCosmetics(current.userId);
    return { items };
  }

  /**
   * Equip a cosmetic the user owns. Other items of the same type get
   * unequipped automatically (one frame, one vehicle, etc., active at a time).
   */
  @Post(':userCosmeticId/equip')
  async equip(
    @CurrentUser() current: AuthenticatedUser,
    @Param('userCosmeticId') userCosmeticId: string,
  ) {
    const cosmetic = await this.cosmetics.equip(current.userId, userCosmeticId);
    return { cosmetic };
  }
}
