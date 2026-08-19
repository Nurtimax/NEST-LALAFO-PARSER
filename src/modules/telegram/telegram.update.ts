import { Logger } from '@nestjs/common';
import { Action, Ctx, On, Start, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramStateService } from './telegram-state.service';
import { TelegramNotifyService } from './telegram-notify.service';
import { buildDecisionKeyboard } from './decision-keyboard';
import { MalbazarTaxonomyService } from '../malbazar/malbazar-taxonomy.service';
import { MalbazarPublishService } from '../malbazar/malbazar-publish.service';

@Update()
export class TelegramUpdate {
  private readonly logger = new Logger(TelegramUpdate.name);

  constructor(
    private readonly state: TelegramStateService,
    private readonly notify: TelegramNotifyService,
    private readonly taxonomy: MalbazarTaxonomyService,
    private readonly publish: MalbazarPublishService,
  ) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    await this.registerIfGroup(ctx, true);
  }

  // Auto-detects the group the bot should post to: the first group/supergroup
  // it sees a message in, so nobody has to look up and paste a chat id.
  @On('message')
  async onMessage(@Ctx() ctx: Context) {
    await this.registerIfGroup(ctx, false);
  }

  private async registerIfGroup(ctx: Context, explicit: boolean) {
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) {
      return;
    }

    const current = await this.state.getGroupChatId();
    if (current === chat.id && !explicit) return;
    if (current && current !== chat.id && !explicit) return;

    await this.state.setGroupChatId(chat.id);
    this.logger.log(`Registered Telegram group ${chat.id} for product posts`);
    if (explicit) {
      await ctx.reply('✅ Эта группа зарегистрирована для отправки товаров.');
    }
  }

  // "Одобрить" doesn't publish right away — malbazar has no phone-category,
  // so a human has to pick which malbazar category this listing belongs to.
  @Action(/^approve:(.+)$/)
  async onApprove(@Ctx() ctx: Context) {
    const productId = this.matchedId(ctx, 1);
    if (!productId) return ctx.answerCbQuery();
    await ctx.answerCbQuery();

    const categories = await this.taxonomy.getCategories();
    const rows: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < categories.length; i += 2) {
      rows.push(
        categories.slice(i, i + 2).map((c) => ({
          text: c.name,
          callback_data: `cat:${c.id}:${productId}`,
        })),
      );
    }
    rows.push([{ text: '◀️ Отмена', callback_data: `cancel:${productId}` }]);

    await ctx
      .editMessageReplyMarkup({ inline_keyboard: rows })
      .catch((error) =>
        this.logger.warn(`Could not show category picker: ${error}`),
      );
  }

  @Action(/^cancel:(.+)$/)
  async onCancelCategoryPick(@Ctx() ctx: Context) {
    const productId = this.matchedId(ctx, 1);
    if (!productId) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    const product = await this.state.getProduct(productId);
    await ctx
      .editMessageReplyMarkup(
        buildDecisionKeyboard({ id: productId, link: product?.link }),
      )
      .catch(() => undefined);
  }

  @Action(/^cat:(\d+):(.+)$/)
  async onCategoryChosen(@Ctx() ctx: Context) {
    const categoryId = Number(this.matchedId(ctx, 1));
    const productId = this.matchedId(ctx, 2);
    if (!productId || !categoryId) return ctx.answerCbQuery();

    await ctx.answerCbQuery('Публикую на malbazar…');
    await ctx
      .editMessageReplyMarkup({
        inline_keyboard: [[{ text: '⏳ Публикую…', callback_data: 'noop' }]],
      })
      .catch(() => undefined);

    const product = await this.state.getProduct(productId);
    if (!product) {
      await this.appendStatus(
        ctx,
        '⚠️ Данные товара устарели (перезапуск бота) — публикация невозможна.',
      );
      return;
    }

    const result = await this.publish.publish(product, categoryId);
    if (result.success) {
      this.logger.log(
        `Product ${productId} published to malbazar as id=${result.malbazarProductId}`,
      );
      // The group is a pending-decision queue, not a log — once resolved
      // (published, deleted, or banned) the message is removed either way.
      await ctx.deleteMessage().catch(() => undefined);
      await this.state.resolveInFlight(productId, 'approved');
      await this.notify.trySendNext();
    } else {
      await this.appendStatus(ctx, `❌ Ошибка публикации: ${result.error}`);
      await ctx
        .editMessageReplyMarkup(
          buildDecisionKeyboard({ id: productId, link: product.link }),
        )
        .catch(() => undefined);
    }
  }

  @Action(/^delete:(.+)$/)
  async onDelete(@Ctx() ctx: Context) {
    const id = this.matchedId(ctx, 1);
    if (id) await this.state.resolveInFlight(id, 'deleted');
    await ctx.answerCbQuery('Удалено 🗑');
    await ctx.deleteMessage().catch(() => undefined);
    await this.notify.trySendNext();
  }

  @Action(/^ban:(.+)$/)
  async onBan(@Ctx() ctx: Context) {
    const id = this.matchedId(ctx, 1);
    if (id) await this.state.resolveInFlight(id, 'banned');
    await ctx.answerCbQuery('Забанено 🚫');
    await ctx.deleteMessage().catch(() => undefined);
    await this.notify.trySendNext();
  }

  @Action('noop')
  async onNoop(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
  }

  private matchedId(ctx: Context, group: number): string | null {
    const match = (ctx as unknown as { match?: RegExpExecArray }).match;
    return match?.[group] ?? null;
  }

  private async appendStatus(ctx: Context, label: string) {
    const message = ctx.callbackQuery?.message as
      { caption?: string; text?: string } | undefined;
    const original = message?.caption ?? message?.text ?? '';
    const updated = `${original}\n\n${label}`;

    try {
      if (message?.caption !== undefined) {
        await ctx.editMessageCaption(updated, { parse_mode: 'HTML' });
      } else {
        await ctx.editMessageText(updated, { parse_mode: 'HTML' });
      }
    } catch (error) {
      this.logger.warn(`Could not update message status: ${error}`);
    }
  }
}
