import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { NumericIdService } from './numeric-id.service';
import { Counter, CounterSchema } from './schemas/counter.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Counter.name, schema: CounterSchema }]),
  ],
  providers: [NumericIdService],
  exports: [NumericIdService],
})
export class CommonModule {}
