import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { CategoryParserService } from './services/parser.service';
import { CategoryModelsService } from './services/category-models.service';
import { ProductParserService } from './services/product-parser.service';
import { ParseStatusService } from './services/parse-status.service';
import { ParseStatusReporterService } from './services/parse-status-reporter.service';
import { ParseControlUpdate } from './services/parse-control.update';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [TelegramModule],
  controllers: [CategoriesController],
  providers: [
    CategoriesService,
    CategoryParserService,
    CategoryModelsService,
    ProductParserService,
    ParseStatusService,
    ParseStatusReporterService,
    ParseControlUpdate,
  ],
  exports: [CategoriesService],
})
export class CategoriesModule {}
