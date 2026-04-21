import { Module } from '@nestjs/common';

import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { AdminSeedService } from './admin-seed.service';
import { AdminUsersController } from './admin-users/admin-users.controller';
import { AdminUsersModule } from './admin-users/admin-users.module';
import { AppUsersModule } from './app-users/app-users.module';

@Module({
  imports: [AdminUsersModule, AdminAuthModule, AppUsersModule],
  controllers: [AdminUsersController],
  providers: [AdminSeedService],
})
export class AdminModule {}
