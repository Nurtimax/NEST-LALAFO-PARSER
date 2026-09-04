import { Injectable } from '@nestjs/common';

export interface CarParseResult {
  brand: string;
  slug: string;
  modelsCount: number;
}

export interface CarParseError {
  brand: string;
  error: string;
}

export interface CarParseStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  totalBrands: number;
  processed: number;
  currentBrand: string | null;
  results: CarParseResult[];
  errors: CarParseError[];
}

// In-memory only: this tracks a single bulk-parse run tied to the live
// process, same rationale as ParseStatusService in the categories module.
@Injectable()
export class CarParseStatusService {
  private status: CarParseStatus = {
    running: false,
    startedAt: null,
    finishedAt: null,
    totalBrands: 0,
    processed: 0,
    currentBrand: null,
    results: [],
    errors: [],
  };

  start(totalBrands: number) {
    this.status = {
      running: true,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      totalBrands,
      processed: 0,
      currentBrand: null,
      results: [],
      errors: [],
    };
  }

  setCurrent(brand: string) {
    this.status.currentBrand = brand;
  }

  recordSuccess(brand: string, slug: string, modelsCount: number) {
    this.status.results.push({ brand, slug, modelsCount });
    this.status.processed += 1;
  }

  recordError(brand: string, error: string) {
    this.status.errors.push({ brand, error });
    this.status.processed += 1;
  }

  finish() {
    this.status.running = false;
    this.status.currentBrand = null;
    this.status.finishedAt = new Date().toISOString();
  }

  isRunning(): boolean {
    return this.status.running;
  }

  getStatus(): CarParseStatus {
    return {
      ...this.status,
      results: [...this.status.results],
      errors: [...this.status.errors],
    };
  }
}
