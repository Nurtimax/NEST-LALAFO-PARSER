import { Injectable } from '@nestjs/common';
import { CategoryParserService } from './services/parser.service';
import { GetCategoriesDto } from './dto/get-categories.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly categoryParserService: CategoryParserService) {}

  getCategoryParser(getCategoriesDto: GetCategoriesDto) {
    return this.categoryParserService.getCategoryParser(getCategoriesDto);
  }
}
