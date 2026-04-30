import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { AdminOnly } from '../admin/admin-auth/decorators/admin-only.decorator';
import { CurrentAdmin } from '../admin/admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { AuthenticatedAdmin } from '../admin/admin-auth/strategies/admin-jwt.strategy';
import { PERMISSIONS } from '../admin/permissions.catalog';
import { ResellersService } from './resellers.service';
import {
  AssignToUserDto,
  CreateResellerDto,
  TopupPoolDto,
  UpdateResellerDto,
  UpdateResellerStatusDto,
} from './dto/reseller.dto';
import { ResellerLedgerType } from './schemas/reseller-ledger.schema';
import { ResellerStatus } from './schemas/reseller.schema';

@Controller({ path: 'admin/resellers', version: '1' })
@AdminOnly()
export class ResellersController {
  constructor(private readonly resellers: ResellersService) {}

  // ---------- CRUD ----------

  @RequirePermissions(PERMISSIONS.RESELLER_VIEW)
  @Get()
  async list(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: ResellerStatus,
    @Query('country') country?: string,
    @Query('search') search?: string,
  ) {
    return this.resellers.list({ page, limit, status, country, search }, admin);
  }

  @RequirePermissions(PERMISSIONS.RESELLER_VIEW)
  @Get(':id')
  async getOne(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const reseller = await this.resellers.findById(id, admin);
    return { reseller };
  }

  @RequirePermissions(PERMISSIONS.RESELLER_MANAGE)
  @Post()
  async create(@Body() dto: CreateResellerDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const reseller = await this.resellers.create({ ...dto, createdBy: admin.adminId });
    return { reseller };
  }

  @RequirePermissions(PERMISSIONS.RESELLER_MANAGE)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateResellerDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const reseller = await this.resellers.update(id, dto, admin);
    return { reseller };
  }

  @RequirePermissions(PERMISSIONS.RESELLER_MANAGE)
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateResellerStatusDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const reseller = await this.resellers.updateStatus(id, dto.status, admin);
    return { reseller };
  }

  // ---------- Pool top-up (admin only) ----------

  @RequirePermissions(PERMISSIONS.WALLET_MINT, PERMISSIONS.RESELLER_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Post(':id/topup')
  async topupPool(
    @Param('id') id: string,
    @Body() dto: TopupPoolDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    if (admin.scopeType === 'reseller') {
      throw new BadRequestException({
        code: 'SCOPED_CANNOT_TOPUP',
        message: 'Reseller admins cannot top up their own pool. Ask a global admin.',
      });
    }
    const idemKey = dto.idempotencyKey || `topup-${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await this.resellers.topupPool(
      id,
      dto.amount,
      dto.reason,
      admin.adminId,
      idemKey,
      admin,
    );
    return result;
  }

  // ---------- Assign coins (reseller's own admin OR global admin) ----------

  @RequirePermissions(PERMISSIONS.RESELLER_DISTRIBUTE_COINS)
  @HttpCode(HttpStatus.OK)
  @Post(':id/assign-to-user')
  async assignToUser(
    @Param('id') id: string,
    @Body() dto: AssignToUserDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    if (!dto.idempotencyKey) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'idempotencyKey is required',
      });
    }
    return this.resellers.assignToUser(
      id,
      dto.userId,
      dto.amount,
      dto.reason ?? '',
      admin.adminId,
      dto.idempotencyKey,
      admin,
    );
  }

  // ---------- Pool ledger ----------

  @RequirePermissions(PERMISSIONS.RESELLER_VIEW)
  @Get(':id/ledger')
  async listLedger(
    @Param('id') id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('type') type?: ResellerLedgerType,
  ) {
    return this.resellers.listLedger(id, admin, { page, limit, type });
  }
}
