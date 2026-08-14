import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CategoriesModule } from './modules/categories/categories.module';
import { CategoryParserService } from './modules/categories/services/parser.service';

@Module({
  imports: [CategoriesModule],
  controllers: [AppController],
  providers: [AppService, CategoryParserService],
  exports: [AppService, CategoryParserService],
})
export class AppModule {}
