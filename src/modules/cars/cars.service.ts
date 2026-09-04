import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import path from 'path';
import { CategoriesService } from '../categories/categories.service';
import {
  CarBrand,
  CarBrandsParserService,
} from './services/car-brands-parser.service';
import { CarParseStatusService } from './services/car-parse-status.service';
import { ParseCarModelsDto } from './dto/parse-car-models.dto';

const SLUG_PATTERN = /^[a-z0-9-]+$/;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class CarsService {
  private readonly carsDir = path.join(process.cwd(), 'public/api/cars');

  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly carBrandsParserService: CarBrandsParserService,
    private readonly carParseStatusService: CarParseStatusService,
  ) {}

  async parseBrands(): Promise<CarBrand[]> {
    return this.carBrandsParserService.parseBrands();
  }

  async parseModels(dto: ParseCarModelsDto) {
    const brandSlug = dto.slug ?? this.slugifyOrThrow(dto.name);
    const result = await this.parseBrandModels(dto.url, dto.name, brandSlug);

    return {
      brand_name: dto.name,
      models: result.models,
    };
  }

  // Parses the full brand list, then walks every brand's model list one at
  // a time (a shared browser is reused via CategoriesService, but pages are
  // fetched sequentially to avoid hammering lalafo with 100+ concurrent
  // scrapes). Runs in the background — the caller polls getBulkStatus().
  async parseAll() {
    if (this.carParseStatusService.isRunning()) {
      throw new ConflictException('A bulk parse is already running');
    }

    const brands = await this.carBrandsParserService.parseBrands();
    this.carParseStatusService.start(brands.length);

    void this.runBulkParse(brands);

    return {
      message: `Started parsing ${brands.length} brands in the background`,
      totalBrands: brands.length,
    };
  }

  getBulkStatus() {
    return this.carParseStatusService.getStatus();
  }

  private async runBulkParse(brands: CarBrand[]) {
    for (const brand of brands) {
      this.carParseStatusService.setCurrent(brand.name);

      // Prefer a clean slugified brand name (e.g. "honda", "mercedes-benz")
      // to match the existing folder convention. Only fall back to
      // brand.slug (lalafo's own URL path segment, e.g.
      // "ford-avtomobili-s-probegom") when the name is Cyrillic-only and
      // slugify() would otherwise collapse to an empty string, colliding
      // every such brand (ВАЗ, ГАЗ, УАЗ, ...) onto the same file.
      const brandSlug = slugify(brand.name) || brand.slug;

      try {
        const result = await this.parseBrandModels(
          brand.url,
          brand.name,
          brandSlug,
        );
        this.carParseStatusService.recordSuccess(
          brand.name,
          brandSlug,
          result.models.length,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.carParseStatusService.recordError(brand.name, message);
      }
    }

    this.carParseStatusService.finish();
  }

  private async parseBrandModels(url: string, name: string, slug: string) {
    return this.categoriesService.getCategoryParser({
      url,
      name,
      slug: `cars/${slug}`,
    });
  }

  private slugifyOrThrow(name: string): string {
    const slug = slugify(name);

    if (!slug) {
      throw new BadRequestException(
        `Could not derive a slug from "${name}" — pass an explicit "slug" field`,
      );
    }

    return slug;
  }

  async getCachedBrands(): Promise<CarBrand[]> {
    try {
      const raw = await fs.readFile(
        path.join(this.carsDir, 'brands.json'),
        'utf-8',
      );
      return JSON.parse(raw) as CarBrand[];
    } catch {
      throw new NotFoundException(
        'Brand list not parsed yet — call POST /cars/parse-brands first',
      );
    }
  }

  async getCachedModels(slug: string) {
    if (!SLUG_PATTERN.test(slug)) {
      throw new BadRequestException(`Invalid brand slug: ${slug}`);
    }

    let raw: string;

    try {
      raw = await fs.readFile(
        path.join(this.carsDir, slug, 'data.json'),
        'utf-8',
      );
    } catch {
      throw new NotFoundException(
        `Brand "${slug}" not parsed yet — call POST /cars/parse-models first`,
      );
    }

    const data = JSON.parse(raw) as { name: string; models: unknown[] };

    return {
      brand_name: data.name,
      models: data.models,
    };
  }
}
