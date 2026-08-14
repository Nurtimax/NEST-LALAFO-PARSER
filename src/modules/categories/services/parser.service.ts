/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  InternalServerErrorException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Browser, chromium, Page } from 'playwright';
import { GetCategoriesDto } from '../dto/get-categories.dto';
import path from 'path';
import * as fs from 'fs/promises';

interface Model {
  name: string;
  slug: string;
  colors: string[];
  rams: string[];
  memories: string[];
}

interface CategoryData {
  name: string;
  slug: string;
  models: Model[];
  // ...другие поля
}

@Injectable()
export class CategoryParserService implements OnModuleInit, OnModuleDestroy {
  private browser: Browser;

  constructor() {}

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

  async writeJsonFile(data: any, filename: string) {
    const filePath = path.join(process.cwd(), 'public/api/', filename);

    try {
      // 1. Ensure the directory exists (optional but recommended)
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // 2. Convert object to pretty-printed JSON string
      const jsonString = JSON.stringify(data, null, 2);

      // 3. Write stringified data to the file system
      await fs.writeFile(filePath, jsonString, 'utf-8');
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to write file: ${error.message}`,
      );
    }
  }

  async getAllModels(page: Page, modelText?: string): Promise<Model[]> {
    // Открываем дропдаун "Модель"
    await page.getByText('Модель', { exact: true }).click();

    // Берём только активную (раскрытую) панель фильтра
    const activePanel = page
      .locator(
        'div[class*="FilterViewDesktop_filterListWrapper"][class*="showFilterList"]',
      )
      .first();

    const grid = activePanel.locator('.ReactVirtualized__Grid');
    await grid.waitFor({ state: 'visible' });

    const models = new Map<string, string>();
    let sameCountStreak = 0;

    while (sameCountStreak < 3) {
      const current = await grid.evaluate((el) =>
        Array.from(el.querySelectorAll('input[type="checkbox"]')).map(
          (input) => ({
            value: (input as HTMLInputElement).value,
            label:
              input.closest('label')?.querySelector('p')?.textContent?.trim() ??
              '',
          }),
        ),
      );

      const before = models.size;
      current.forEach((item) => {
        console.log(`Found model: ${item.label} with value: ${item.value}`);

        models.set(item.value, item.label);
      });
      sameCountStreak = models.size === before ? sameCountStreak + 1 : 0;

      const { scrollTop, scrollHeight, clientHeight } = await grid.evaluate(
        (el) => ({
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        }),
      );

      if (scrollTop + clientHeight >= scrollHeight) break;

      await grid.evaluate((el, step) => {
        el.scrollTop += step;
      }, clientHeight);

      await page.waitForTimeout(150);
    }

    return Array.from(models, ([value, label]) => ({
      value,
      name: label,
      slug: `${modelText}-${label.toLowerCase().replace(/\s+/g, '-')}`.toLowerCase(),
      colors: [],
      rams: [],
      memories: [],
    }));
  }

  async getCategoryParser(getCategoriesDto: GetCategoriesDto) {
    const { url } = getCategoriesDto;

    const context = await this.browser.newContext();
    const page: Page = await context.newPage();

    const data: CategoryData = {
      name: getCategoriesDto.name,
      slug: getCategoriesDto.slug,
      models: [],
    };

    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      const title = await page.title();

      const models = await this.getAllModels(page, getCategoriesDto.name);
      const message = `Found ${models.length} models for category ${data.name}`;

      data.models = models;

      await this.writeJsonFile(data, `${data.slug}/data.json`);

      return {
        title,
        message,
      };
    } finally {
      // Always close contexts to free up server RAM
      await context.close();
    }
  }
}
