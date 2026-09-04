import {
  Injectable,
  InternalServerErrorException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Browser, chromium } from 'playwright';
import * as fs from 'fs/promises';
import path from 'path';

// The "Продажа авто" landing page: same quick-nav widget
// ([data-component="category-tab-list"]) that lists car brands here also
// lists a brand's own models when it renders on that brand's page, e.g.
// https://lalafo.kg/kyrgyzstan/avtomobili-s-probegom/prodazha-avtomobiley/toyota
const CARS_BASE_URL = 'https://lalafo.kg/kyrgyzstan/avtomobili-s-probegom';

export interface CarBrand {
  name: string;
  slug: string;
  url: string;
}

@Injectable()
export class CarBrandsParserService implements OnModuleInit, OnModuleDestroy {
  private browser: Browser;

  async onModuleInit() {
    this.browser = await chromium.launch({ headless: true });
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async parseBrands(): Promise<CarBrand[]> {
    const context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'ru-RU',
    });

    const page = await context.newPage();

    try {
      await page.goto(CARS_BASE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      const tabList = page.locator('[data-component="category-tab-list"]');
      await tabList.waitFor({ state: 'visible', timeout: 30000 });

      // The full brand list is collapsed behind a "Еще" (show more) toggle;
      // only a couple of brands render before it's clicked.
      const moreButton = tabList.locator('button[data-component="lfbutton"]');
      if (await moreButton.count()) {
        await moreButton.click();
        await page.waitForTimeout(300);
      }

      const links = await tabList.evaluate((el) =>
        Array.from(el.querySelectorAll('nav a')).map((a) => ({
          name: a.textContent?.trim() ?? '',
          href: a.getAttribute('href') ?? '',
        })),
      );

      const brands: CarBrand[] = links
        .filter((link) => link.name && link.href)
        .map((link) => ({
          name: link.name,
          slug: link.href.split('/').filter(Boolean).pop() as string,
          url: `https://lalafo.kg${link.href}`,
        }));

      await this.writeJsonFile(brands, 'cars/brands.json');

      return brands;
    } finally {
      await context.close();
    }
  }

  private async writeJsonFile(data: unknown, filename: string) {
    const filePath = path.join(process.cwd(), 'public/api/', filename);

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(
        `Failed to write file: ${message}`,
      );
    }
  }
}
