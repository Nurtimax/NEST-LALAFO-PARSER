import { Body, Controller, Get, Post } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { GetCategoriesDto } from './dto/get-categories.dto';
import { GetProductDto } from './dto/get-product.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post('parse-categories-model-list')
  async parseCategories(@Body() getCategoriesDto: GetCategoriesDto) {
    return this.categoriesService.getCategoryParser(getCategoriesDto);
  }

  @Post('parse-product')
  async parseProduct(@Body() getProductDto: GetProductDto) {
    return this.categoriesService.getProductParser(getProductDto);
  }

  @Get('parse-status')
  async parseStatus() {
    return this.categoriesService.getStatus();
  }
}
