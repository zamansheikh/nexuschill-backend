import { Module } from '@nestjs/common';

import { UsersModule } from '../../users/users.module';
import { AdminUsersModule } from '../admin-users/admin-users.module';
import { AppUsersController } from './app-users.controller';

@Module({
  imports: [UsersModule, AdminUsersModule],
  controllers: [AppUsersController],
})
export class AppUsersModule {}
