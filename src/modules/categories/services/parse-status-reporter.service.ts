import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ParseStatusService } from './parse-status.service';
import { TelegramNotifyService } from '../../telegram/telegram-notify.service';
import { escapeHtml } from '../../telegram/html.util';

const THIRTY_MINUTES = 30 * 60 * 1000;

function formatDuration(fromIso: string): string {
  const ms = Date.now() - new Date(fromIso).getTime();
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
}

@Injectable()
export class ParseStatusReporterService {
  constructor(
    private readonly parseStatus: ParseStatusService,
    private readonly telegramNotify: TelegramNotifyService,
  ) {}

  @Interval(THIRTY_MINUTES)
  async reportStatus() {
    const { text, keyboard } = await this.buildStatusMessage();
    await this.telegramNotify.sendStatusMessage(text, keyboard);
  }

  // Shared by the 30-minute auto-report and the on-demand /status command
  // (see ParseControlUpdate) so the two never drift apart.
  async buildStatusMessage() {
    const parse = this.parseStatus.getStatus();
    const telegram = await this.telegramNotify.getQueueStatus();

    const lines = ['📊 <b>Статус парсинга</b>'];

    if (parse.running && parse.startedAt) {
      lines.push(
        `⏳ Идёт: раунд ${parse.round}, найдено ${parse.productsFound}`,
        `🕐 Запущен ${formatDuration(parse.startedAt)} назад`,
      );
    } else if (parse.error) {
      lines.push(`❌ Остановлен с ошибкой: ${escapeHtml(parse.error)}`);
    } else if (parse.stoppedByUser) {
      lines.push('⏹ Остановлен вручную');
    } else if (parse.finishedAt) {
      lines.push(`✅ Завершён (${parse.productsFound} товаров)`);
    } else {
      lines.push('⏸ Парсинг ещё не запускался');
    }

    const inFlightLabel = telegram.inFlightTitle
      ? escapeHtml(telegram.inFlightTitle)
      : 'нет';
    lines.push(
      '',
      `📥 В очереди: ${telegram.queueLength}`,
      `👀 На модерации: ${inFlightLabel}`,
      `✅ Всего известно: ${telegram.knownCount}, забанено: ${telegram.bannedCount}`,
    );

    const keyboard = {
      inline_keyboard: [
        [
          parse.running
            ? { text: '⏹ Стоп', callback_data: 'parse:stop' }
            : { text: '▶️ Старт', callback_data: 'parse:start' },
          { text: '🔄 Обновить', callback_data: 'parse:refresh' },
        ],
        [{ text: '🗑 Удалить все данные', callback_data: 'parse:reset' }],
      ],
    };

    return { text: lines.join('\n'), keyboard };
  }
}
