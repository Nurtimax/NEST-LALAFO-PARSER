import { InlineKeyboardButton } from '@telegraf/types';
import { ParsedProduct } from './product.interface';

// Shared between the initial send (telegram-notify.service.ts) and
// re-showing after cancel/error (telegram.update.ts) so the two never
// drift out of sync with each other.
export function buildDecisionKeyboard(product: {
  id: string;
  link?: ParsedProduct['link'];
}) {
  const rows: InlineKeyboardButton[][] = [];

  if (product.link) {
    rows.push([{ text: '🔗 Открыть на lalafo', url: product.link }]);
  }

  rows.push([{ text: '✅ Одобрить', callback_data: `approve:${product.id}` }]);
  rows.push([
    { text: '🗑 Удалить', callback_data: `delete:${product.id}` },
    { text: '🚫 Забанить', callback_data: `ban:${product.id}` },
  ]);

  return { inline_keyboard: rows };
}
