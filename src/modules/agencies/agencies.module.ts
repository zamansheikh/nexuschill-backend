import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AdminAuthModule } from '../admin/admin-auth/admin-auth.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { UsersModule } from '../users/users.module';
import { AgenciesController } from './agencies.controller';
import { AgenciesService } from './agencies.service';
import { Agency, AgencySchema } from './schemas/agency.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Agency.name, schema: AgencySchema }]),
    UsersModule,
    SystemConfigModule,
    AdminAuthModule,
  ],
  controllers: [AgenciesController],
  providers: [AgenciesService],
  exports: [AgenciesService],
})
export class AgenciesModule {}
