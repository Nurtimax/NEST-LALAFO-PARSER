import { Injectable } from '@nestjs/common';
import {
  MalbazarApiService,
  MalbazarCategory,
  MalbazarPlace,
} from './malbazar-api.service';

// Malbazar has no "мобильные телефоны"-style category — everything this
// bot posts (parsed from lalafo) goes into the generic catch-all bucket.
const FALLBACK_CATEGORY_NAME = 'Другое';
// Almost everything this parser scrapes is Bishkek listings anyway, so a
// city/region name that doesn't match anything falls back to Bishkek.
const FALLBACK_PLACE_NAME = 'Бишкек';

@Injectable()
export class MalbazarTaxonomyService {
  private categories: MalbazarCategory[] | null = null;
  private regions: MalbazarPlace[] | null = null;
  private cities: MalbazarPlace[] | null = null;

  constructor(private readonly api: MalbazarApiService) {}

  async getCategories(): Promise<MalbazarCategory[]> {
    if (!this.categories) {
      this.categories = await this.api.getCategories();
    }
    return this.categories;
  }

  async getFallbackCategoryId(): Promise<number> {
    const categories = await this.getCategories();
    const fallback = categories.find((c) => c.name === FALLBACK_CATEGORY_NAME);
    return fallback?.id ?? categories[0].id;
  }

  async resolvePlace(locationText: string | null | undefined): Promise<{
    regionId: number;
    cityId: number;
    cityName: string;
    matched: boolean;
  }> {
    if (!this.regions) this.regions = await this.api.getRegions();
    if (!this.cities) this.cities = await this.api.getCities();

    const normalized = (locationText ?? '').trim().toLowerCase();
    const matchByName = (place: MalbazarPlace) => {
      if (!normalized) return false;
      const name = place.name.toLowerCase();
      return normalized.includes(name) || name.includes(normalized);
    };

    const matchedCity = this.cities.find(matchByName);
    const city =
      matchedCity ??
      this.cities.find((c) => c.name === FALLBACK_PLACE_NAME) ??
      this.cities[0];
    const region =
      this.regions.find(matchByName) ??
      this.regions.find((r) => r.name === FALLBACK_PLACE_NAME) ??
      this.regions[0];

    return {
      regionId: region.id,
      cityId: city.id,
      cityName: city.name,
      matched: !!matchedCity,
    };
  }
}
