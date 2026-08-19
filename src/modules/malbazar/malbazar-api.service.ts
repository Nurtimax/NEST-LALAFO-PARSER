import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface MalbazarCategory {
  id: number;
  name: string;
}

export interface MalbazarPlace {
  id: number;
  name: string;
  name_ru?: string;
}

export interface CreateMalbazarProductPayload {
  title: string;
  description: string;
  village: string;
  price: number;
  currency: string;
  status: string;
  images?: string[];
  phones?: string[];
  category_id: number;
  region_id: number;
  city_id: number;
}

// Decodes the JWT payload without verifying the signature — we only need
// `exp` to know when to re-login, and the server is the one enforcing it.
function decodeJwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    const json = Buffer.from(payload, 'base64url').toString('utf-8');
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return exp ? exp * 1000 : null;
  } catch {
    return null;
  }
}

@Injectable()
export class MalbazarApiService {
  private readonly logger = new Logger(MalbazarApiService.name);
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;

  private token: string | null = null;
  private tokenExpiresAt: number | null = null;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.getOrThrow<string>('MALBAZAR_API_URL');
    this.username = this.config.getOrThrow<string>('MALBAZAR_USERNAME');
    this.password = this.config.getOrThrow<string>('MALBAZAR_PASSWORD');
  }

  private async login(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Malbazar login failed: ${response.status} ${await response.text()}`,
      );
    }

    const data = (await response.json()) as { result: { token: string } };
    this.token = data.result.token;
    this.tokenExpiresAt = decodeJwtExpiry(this.token);
    this.logger.log('Logged in to Malbazar API');
    return this.token;
  }

  // 5 minute safety margin before the JWT actually expires.
  private async getToken(): Promise<string> {
    const isStale =
      !this.token ||
      !this.tokenExpiresAt ||
      this.tokenExpiresAt - Date.now() < 5 * 60_000;
    if (isStale) {
      await this.login();
    }
    return this.token as string;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retryOn401 = true,
  ): Promise<T> {
    const token = await this.getToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 401 && retryOn401) {
      this.token = null;
      return this.request<T>(method, path, body, false);
    }

    if (!response.ok) {
      throw new Error(
        `Malbazar ${method} ${path} failed: ${response.status} ${await response.text()}`,
      );
    }

    return (await response.json()) as T;
  }

  async createProduct(payload: CreateMalbazarProductPayload): Promise<number> {
    const data = await this.request<{ result: { id: number } }>(
      'POST',
      '/api/products',
      payload,
    );
    return data.result.id;
  }

  async getCategories(): Promise<MalbazarCategory[]> {
    const data = await this.request<{ result: MalbazarCategory[] }>(
      'GET',
      '/api/categories',
    );
    return data.result;
  }

  async getRegions(): Promise<MalbazarPlace[]> {
    return this.request<MalbazarPlace[]>('GET', '/api/regions/list');
  }

  async getCities(): Promise<MalbazarPlace[]> {
    return this.request<MalbazarPlace[]>('GET', '/api/cities/list');
  }
}
