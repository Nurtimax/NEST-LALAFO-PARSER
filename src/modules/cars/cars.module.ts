import { Module } from '@nestjs/common';
import { CarsController } from './cars.controller';
import { CarsService } from './cars.service';
import { CarBrandsParserService } from './services/car-brands-parser.service';
import { CarParseStatusService } from './services/car-parse-status.service';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [CategoriesModule],
  controllers: [CarsController],
  providers: [CarsService, CarBrandsParserService, CarParseStatusService],
})
export class CarsModule {}
