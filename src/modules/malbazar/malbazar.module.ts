import { Module } from '@nestjs/common';
import { MalbazarApiService } from './malbazar-api.service';
import { MalbazarTaxonomyService } from './malbazar-taxonomy.service';
import { MalbazarPublishService } from './malbazar-publish.service';

@Module({
  providers: [
    MalbazarApiService,
    MalbazarTaxonomyService,
    MalbazarPublishService,
  ],
  exports: [MalbazarTaxonomyService, MalbazarPublishService],
})
export class MalbazarModule {}
