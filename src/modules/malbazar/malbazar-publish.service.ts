import { Injectable, Logger } from '@nestjs/common';
import { MalbazarApiService } from './malbazar-api.service';
import { MalbazarTaxonomyService } from './malbazar-taxonomy.service';
import { ParsedProduct } from '../telegram/product.interface';

export interface PublishResult {
  success: boolean;
  malbazarProductId?: number;
  error?: string;
}

function parsePrice(priceText: string | null | undefined): number {
  if (!priceText) return 0;
  const digits = priceText.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function resolveImageUrl(imageUrl: string): string {
  const firstUrl = imageUrl.split(',')[0].trim().split(' ')[0];
  return firstUrl.startsWith('http')
    ? firstUrl
    : `https://lalafo.kg${firstUrl}`;
}

@Injectable()
export class MalbazarPublishService {
  private readonly logger = new Logger(MalbazarPublishService.name);

  constructor(
    private readonly api: MalbazarApiService,
    private readonly taxonomy: MalbazarTaxonomyService,
  ) {}

  async publish(
    product: ParsedProduct,
    categoryId: number,
  ): Promise<PublishResult> {
    try {
      const { regionId, cityId } = await this.taxonomy.resolvePlace(
        product.location,
      );

      // The phone number is captured up front during parsing (see
      // ProductParserService) instead of re-visiting the lalafo page here —
      // approval just uses whatever's already on the product.
      const malbazarProductId = await this.api.createProduct({
        title: product.title ?? 'Без названия',
        description: product.title ?? 'Без названия',
        village: product.location ?? '',
        price: parsePrice(product.price),
        currency: 'KGS',
        status: 'active',
        images: product.imageUrl ? [resolveImageUrl(product.imageUrl)] : [],
        phones: product.phone ? [product.phone] : [],
        category_id: categoryId,
        region_id: regionId,
        city_id: cityId,
      });

      return { success: true, malbazarProductId };
    } catch (error) {
      this.logger.error(`Failed to publish product ${product.id}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
