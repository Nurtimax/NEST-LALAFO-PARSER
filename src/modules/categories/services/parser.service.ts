import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Browser, chromium, Page } from 'playwright';
import { GetCategoriesDto } from '../dto/get-categories.dto';

import { CategoryModelsService } from './category-models.service';
import { ProductParserService } from './product-parser.service';
import { GetProductDto } from '../dto/get-product.dto';

@Injectable()
export class CategoryParserService implements OnModuleInit, OnModuleDestroy {
  private browser: Browser;

  constructor(
    private readonly categoryModelsService: CategoryModelsService,
    private readonly productParserService: ProductParserService,
  ) {}

  async onModuleInit() {
    console.log('Module initialized');
    this.browser = await chromium.launch({ headless: true });
  }

  async onModuleDestroy() {
    console.log('Module destroyed');
    if (this.browser) {
      await this.browser.close();
    }
  }

  async getCategoryParser(getCategoriesDto: GetCategoriesDto) {
    const context = await this.browser.newContext();
    const page: Page = await context.newPage();

    try {
      return this.categoryModelsService.getCategoryParser(
        getCategoriesDto,
        page,
      );
    } finally {
      // Always close contexts to free up server RAM
      await context.close();
    }
  }

  async getProductParser(
    getProductDto: GetProductDto,
    onBatch?: (products: any[]) => Promise<void>,
    onProgress?: (round: number, productsFound: number) => void,
  ) {
    const context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      permissions: ['geolocation'],
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
    });

    // Set additional headers
    await context.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      Connection: 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    });

    const page: Page = await context.newPage();

    try {
      return await this.productParserService.getProductParser(
        getProductDto,
        page,
        onBatch,
        onProgress,
      );
    } finally {
      // Always close contexts to free up server RAM
      await context.close();
    }
  }
}
