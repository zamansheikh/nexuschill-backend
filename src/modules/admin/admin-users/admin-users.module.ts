import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AdminUsersService } from './admin-users.service';
import { AdminRole, AdminRoleSchema } from './schemas/admin-role.schema';
import { AdminUser, AdminUserSchema } from './schemas/admin-user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AdminRole.name, schema: AdminRoleSchema },
      { name: AdminUser.name, schema: AdminUserSchema },
    ]),
  ],
  providers: [AdminUsersService],
  exports: [AdminUsersService, MongooseModule],
})
export class AdminUsersModule {}
