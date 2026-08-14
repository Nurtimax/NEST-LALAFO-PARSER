import { Body, Controller, Post } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { GetCategoriesDto } from './dto/get-categories.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post('parse-categories')
  async parseCategories(@Body() getCategoriesDto: GetCategoriesDto) {
    return this.categoriesService.getCategoryParser(getCategoriesDto);
  }
}
