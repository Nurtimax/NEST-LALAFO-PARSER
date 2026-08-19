import { Injectable } from '@nestjs/common';
import { CategoryParserService } from './services/parser.service';
import { ParseStatusService } from './services/parse-status.service';
import { GetCategoriesDto } from './dto/get-categories.dto';
import { GetProductDto } from './dto/get-product.dto';
import { TelegramNotifyService } from '../telegram/telegram-notify.service';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly categoryParserService: CategoryParserService,
    private readonly telegramNotifyService: TelegramNotifyService,
    private readonly parseStatus: ParseStatusService,
  ) {}

  getCategoryParser(getCategoriesDto: GetCategoriesDto) {
    return this.categoryParserService.getCategoryParser(getCategoriesDto);
  }

  async getProductParser(getProductDto: GetProductDto) {
    const telegram = { queued: 0, skipped: 0 };
    this.parseStatus.start(getProductDto.url);

    try {
      // A full category can take hours to scroll through, so each batch of
      // newly-found products is queued to Telegram as soon as it's parsed
      // instead of waiting for the whole scrape to finish.
      const result = await this.categoryParserService.getProductParser(
        getProductDto,
        async (batch: unknown[]) => {
          const batchResult = await this.telegramNotifyService.enqueueProducts(
            batch as Parameters<TelegramNotifyService['enqueueProducts']>[0],
          );
          telegram.queued += batchResult.queued;
          telegram.skipped += batchResult.skipped;
        },
        (round, productsFound) => {
          this.parseStatus.progress(round, productsFound);
        },
      );

      this.parseStatus.finish();
      return { ...result, telegram };
    } catch (error) {
      this.parseStatus.fail(
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async getStatus() {
    return {
      parse: this.parseStatus.getStatus(),
      telegram: await this.telegramNotifyService.getQueueStatus(),
    };
  }
}
