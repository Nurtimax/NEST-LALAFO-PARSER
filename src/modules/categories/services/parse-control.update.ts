import { Logger } from '@nestjs/common';
import { Action, Command, Ctx, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { CategoriesService } from '../categories.service';
import { ParseStatusService } from './parse-status.service';
import { ParseStatusReporterService } from './parse-status-reporter.service';
import { TelegramNotifyService } from '../../telegram/telegram-notify.service';

// Falls back to the one category this bot has ever been used for when a
// button-triggered start has no URL to work from (buttons carry no text
// input) and no parse has run yet this process to remember one.
const DEFAULT_PARSE_URL =
  'https://lalafo.kg/kyrgyzstan/mobilnye-telefony-i-aksessuary';

@Update()
export class ParseControlUpdate {
  private readonly logger = new Logger(ParseControlUpdate.name);

  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly parseStatus: ParseStatusService,
    private readonly reporter: ParseStatusReporterService,
    private readonly telegramNotify: TelegramNotifyService,
  ) {}

  @Command('status')
  async onStatusCommand() {
    const { text, keyboard } = await this.reporter.buildStatusMessage();
    // Routed through sendStatusMessage (not ctx.reply) so this shares the
    // "delete the previous status message first" behavior with the
    // 30-minute auto-report — only one status message should exist at once.
    await this.telegramNotify.sendStatusMessage(text, keyboard);
  }

  @Action('parse:start')
  async onStart(@Ctx() ctx: Context) {
    if (this.parseStatus.getStatus().running) {
      await ctx.answerCbQuery('Уже запущен');
      await this.refreshMessage(ctx);
      return;
    }

    const url = this.parseStatus.getStatus().url ?? DEFAULT_PARSE_URL;
    await ctx.answerCbQuery('Запускаю ▶️');

    // Fire-and-forget: a full category parse can take well over a day, far
    // longer than a Telegram callback is allowed to stay open for.
    this.categoriesService.getProductParser({ url }).catch((error) => {
      this.logger.error('Parse triggered from Telegram failed', error);
    });

    await this.refreshMessage(ctx);
  }

  @Action('parse:stop')
  async onStop(@Ctx() ctx: Context) {
    this.parseStatus.requestStop();
    await ctx.answerCbQuery(
      'Останавливаю ⏹ (доработает текущий раунд и остановится)',
    );
    await this.refreshMessage(ctx);
  }

  @Action('parse:refresh')
  async onRefresh(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    await this.refreshMessage(ctx);
  }

  @Action('parse:reset')
  async onResetRequested(@Ctx() ctx: Context) {
    if (this.parseStatus.getStatus().running) {
      await ctx.answerCbQuery('⚠️ Сначала останови парсинг (⏹ Стоп)');
      return;
    }
    await ctx.answerCbQuery();
    await ctx
      .editMessageText(
        '⚠️ <b>Удалить все данные?</b>\n\nОчередь, список известных и забаненных товаров будут стёрты безвозвратно. Регистрация группы сохранится.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '🗑 Да, удалить всё',
                  callback_data: 'parse:reset_confirm',
                },
                { text: '◀️ Отмена', callback_data: 'parse:reset_cancel' },
              ],
            ],
          },
        },
      )
      .catch(() => undefined);
  }

  @Action('parse:reset_confirm')
  async onResetConfirmed(@Ctx() ctx: Context) {
    await this.telegramNotify.resetParsedData();
    this.logger.log('Parsed data reset from Telegram');
    await ctx.answerCbQuery('Удалено 🗑');
    await this.refreshMessage(ctx);
  }

  @Action('parse:reset_cancel')
  async onResetCancelled(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Отменено');
    await this.refreshMessage(ctx);
  }

  private async refreshMessage(ctx: Context) {
    const { text, keyboard } = await this.reporter.buildStatusMessage();
    await ctx
      .editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
      .catch(() => undefined);
  }
}
