import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CarsService } from './cars.service';
import { ParseCarModelsDto } from './dto/parse-car-models.dto';

@Controller('cars')
export class CarsController {
  constructor(private readonly carsService: CarsService) {}

  @Post('parse-brands')
  async parseBrands() {
    return this.carsService.parseBrands();
  }

  @Post('parse-models')
  async parseModels(@Body() dto: ParseCarModelsDto) {
    return this.carsService.parseModels(dto);
  }

  @Post('parse-all')
  async parseAll() {
    return this.carsService.parseAll();
  }

  @Get('parse-all-status')
  getParseAllStatus() {
    return this.carsService.getBulkStatus();
  }

  @Get('brands')
  async getBrands() {
    return this.carsService.getCachedBrands();
  }

  @Get('brands/:slug')
  async getBrandModels(@Param('slug') slug: string) {
    return this.carsService.getCachedModels(slug);
  }
}
