import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { CategoryParserService } from './services/parser.service';

@Module({
  imports: [],
  controllers: [CategoriesController],
  providers: [CategoriesService, CategoryParserService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
