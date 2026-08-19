import { Injectable, Logger } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { InlineKeyboardMarkup } from '@telegraf/types';
import { TelegramStateService } from './telegram-state.service';
import { ParsedProduct } from './product.interface';
import { buildDecisionKeyboard } from './decision-keyboard';
import { escapeHtml } from './html.util';
import { MalbazarTaxonomyService } from '../malbazar/malbazar-taxonomy.service';

// imageUrl can be a plain `src` or a `srcset` list ("/foo 1x, /bar 2x"),
// and lalafo's own <img>/<source> attributes are host-relative.
function resolveImageUrl(imageUrl: string): string {
  const firstUrl = imageUrl.split(',')[0].trim().split(' ')[0];
  return firstUrl.startsWith('http')
    ? firstUrl
    : `https://lalafo.kg${firstUrl}`;
}

function hasNumericPrice(priceText: string | null | undefined): boolean {
  return !!priceText && /\d/.test(priceText);
}

// Shows at a glance which of malbazar's CreateProductDto fields we already
// have real data for versus what's still only decided at approval time
// (category/phones) — lets a moderator judge listing quality before
// clicking Одобрить, without having to open lalafo themselves.
function buildMalbazarChecklist(
  product: ParsedProduct,
  place: { cityName: string; matched: boolean },
): string {
  const dot = (ok: boolean) => (ok ? '🟢' : '🔴');
  const lines = [
    'Данные для malbazar:',
    `${dot(!!product.title)} title/description`,
    `${dot(hasNumericPrice(product.price))} price`,
    `${dot(!!product.location)} village`,
    `${dot(!!product.imageUrl)} images`,
    `${dot(place.matched)} город: ${escapeHtml(place.cityName)}${place.matched ? '' : ' (не сматчен, по умолчанию)'}`,
    `${dot(!!product.phone)} phones`,
    `🔴 category — выбор при одобрении`,
  ];
  return lines.join('\n');
}

function buildCaption(product: ParsedProduct, checklist: string): string {
  const lines = [`<b>${escapeHtml(product.title ?? 'Без названия')}</b>`];
  if (product.price) lines.push(`💰 ${escapeHtml(product.price)}`);
  if (product.location) lines.push(`📍 ${escapeHtml(product.location)}`);
  lines.push('', checklist);
  return lines.join('\n');
}

@Injectable()
export class TelegramNotifyService {
  private readonly logger = new Logger(TelegramNotifyService.name);

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly state: TelegramStateService,
    private readonly taxonomy: MalbazarTaxonomyService,
  ) {}

  async getQueueStatus() {
    return this.state.getSummary();
  }

  async resetParsedData(): Promise<void> {
    await this.state.resetParsedData();
  }

  async sendStatusMessage(
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<void> {
    const chatId = await this.state.getGroupChatId();
    if (!chatId) {
      this.logger.warn(
        'No Telegram group registered yet — skipping status report.',
      );
      return;
    }

    // Keep only one status message in the group at a time rather than
    // letting them pile up every 30 minutes (or every /status).
    const previousId = await this.state.getLastStatusMessageId();
    if (previousId) {
      await this.bot.telegram
        .deleteMessage(chatId, previousId)
        .catch(() => undefined);
    }

    const sent = await this.bot.telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
    await this.state.setLastStatusMessageId(sent.message_id);
  }

  // Queues newly-parsed products (a full category parse can be thousands of
  // items) and, if the group isn't currently waiting on a decision, kicks
  // off sending the first one. The rest trickle out one at a time as each
  // prior message gets Одобрить/Удалить/Забанить — see trySendNext.
  async enqueueProducts(
    products: ParsedProduct[],
  ): Promise<{ queued: number; skipped: number }> {
    const result = await this.state.enqueueNew(products);
    await this.trySendNext();
    return result;
  }

  // Sends the next queued product only if nothing is currently awaiting a
  // decision in the group. Call this after enqueueing and after every
  // Одобрить/Удалить/Забанить so the queue keeps draining one at a time.
  async trySendNext(): Promise<void> {
    const chatId = await this.state.getGroupChatId();
    if (!chatId) {
      this.logger.warn(
        'No Telegram group registered yet — add the bot to a group and send any message there.',
      );
      return;
    }

    const product = await this.state.popNextIfIdle();
    if (!product || !product.id) return;

    try {
      await this.sendProduct(chatId, product);
    } catch (error) {
      this.logger.error(
        `Failed to send product ${product.id} to Telegram, will retry on a later parse`,
        error,
      );
      await this.state.clearFailedInFlight(product.id);
      // Try the next item instead of leaving the queue stuck behind a
      // listing that can't be sent (e.g. a bad image URL).
      await this.trySendNext();
    }
  }

  private async sendProduct(chatId: number, product: ParsedProduct) {
    const place = await this.taxonomy.resolvePlace(product.location);
    const checklist = buildMalbazarChecklist(product, place);
    const caption = buildCaption(product, checklist);
    const replyMarkup = buildDecisionKeyboard(
      product as { id: string; link?: string | null },
    );

    if (product.imageUrl) {
      await this.bot.telegram.sendPhoto(
        chatId,
        resolveImageUrl(product.imageUrl),
        {
          caption,
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        },
      );
    } else {
      await this.bot.telegram.sendMessage(chatId, caption, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      });
    }
  }
}
