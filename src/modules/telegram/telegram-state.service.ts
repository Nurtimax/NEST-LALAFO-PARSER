import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import path from 'path';
import { ParsedProduct } from './product.interface';

interface TelegramState {
  groupChatId: number | null;
  // Every id ever queued/sent/approved — skip re-adding these on a later
  // parse. "Удалить" removes an id from here so it can resurface if it's
  // still listed on lalafo; "Забанить" adds it to bannedIds too, forever.
  knownIds: string[];
  bannedIds: string[];
  // FIFO of product ids waiting to be sent to the group, in parse order.
  queue: string[];
  // The one product currently posted in the group awaiting a decision —
  // only one at a time, so the next queued item waits until this clears.
  inFlightId: string | null;
  products: Record<string, ParsedProduct>;
  // The most recently sent status report — a new one deletes this first,
  // so the group only ever shows one status message, not an accumulating
  // trail of them.
  lastStatusMessageId: number | null;
}

const STATE_FILE = path.join(process.cwd(), 'public/api/telegram/state.json');

const EMPTY_STATE: TelegramState = {
  groupChatId: null,
  knownIds: [],
  bannedIds: [],
  queue: [],
  inFlightId: null,
  products: {},
  lastStatusMessageId: null,
};

// Every call re-reads the file rather than caching in memory, so state
// survives restarts and stays correct if the process is ever scaled out.
@Injectable()
export class TelegramStateService {
  private async read(): Promise<TelegramState> {
    try {
      const raw = await fs.readFile(STATE_FILE, 'utf-8');
      return { ...EMPTY_STATE, ...(JSON.parse(raw) as TelegramState) };
    } catch {
      return { ...EMPTY_STATE };
    }
  }

  private async write(state: TelegramState) {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  }

  async getGroupChatId(): Promise<number | null> {
    return (await this.read()).groupChatId;
  }

  async setGroupChatId(chatId: number): Promise<void> {
    const state = await this.read();
    if (state.groupChatId === chatId) return;
    state.groupChatId = chatId;
    await this.write(state);
  }

  // Adds newly-parsed products to the back of the queue, skipping ones
  // already known (queued/sent/approved) or banned. Does not send anything.
  async enqueueNew(
    products: ParsedProduct[],
  ): Promise<{ queued: number; skipped: number }> {
    const state = await this.read();
    const known = new Set([...state.knownIds, ...state.bannedIds]);

    let queued = 0;
    for (const product of products) {
      if (!product.id || known.has(product.id)) continue;
      state.queue.push(product.id);
      state.products[product.id] = product;
      state.knownIds.push(product.id);
      known.add(product.id);
      queued++;
    }

    await this.write(state);
    return { queued, skipped: products.length - queued };
  }

  // If nothing is currently awaiting a decision, pops the next queued
  // product and marks it in-flight. Returns null if the group is busy or
  // the queue is empty — the caller sends nothing in that case.
  async popNextIfIdle(): Promise<ParsedProduct | null> {
    const state = await this.read();
    if (state.inFlightId || state.queue.length === 0) return null;

    const id = state.queue.shift() as string;
    const product = state.products[id];
    state.inFlightId = id;
    await this.write(state);
    return product ?? null;
  }

  // Drops the in-flight product without marking it known, so a failed send
  // (network hiccup, etc.) can be retried on a later parse.
  async clearFailedInFlight(productId: string): Promise<void> {
    const state = await this.read();
    if (state.inFlightId === productId) state.inFlightId = null;
    delete state.products[productId];
    state.knownIds = state.knownIds.filter((id) => id !== productId);
    await this.write(state);
  }

  async getProduct(productId: string): Promise<ParsedProduct | null> {
    return (await this.read()).products[productId] ?? null;
  }

  async getInFlightId(): Promise<string | null> {
    return (await this.read()).inFlightId;
  }

  async getSummary() {
    const state = await this.read();
    return {
      groupChatId: state.groupChatId,
      queueLength: state.queue.length,
      inFlightId: state.inFlightId,
      inFlightTitle: state.inFlightId
        ? (state.products[state.inFlightId]?.title ?? null)
        : null,
      knownCount: state.knownIds.length,
      bannedCount: state.bannedIds.length,
    };
  }

  // Resolves the currently in-flight product after a moderator decision,
  // freeing the slot for the next queued product to be sent.
  async resolveInFlight(
    productId: string,
    outcome: 'approved' | 'deleted' | 'banned',
  ): Promise<void> {
    const state = await this.read();
    if (state.inFlightId === productId) state.inFlightId = null;
    delete state.products[productId];

    if (outcome === 'deleted') {
      state.knownIds = state.knownIds.filter((id) => id !== productId);
    } else if (outcome === 'banned' && !state.bannedIds.includes(productId)) {
      state.bannedIds.push(productId);
    }

    await this.write(state);
  }

  // Wipes every parsed product, the queue, and the known/banned lists —
  // keeps groupChatId since that's the bot's registration, not scrape data.
  async resetParsedData(): Promise<void> {
    const state = await this.read();
    await this.write({
      ...EMPTY_STATE,
      groupChatId: state.groupChatId,
      lastStatusMessageId: state.lastStatusMessageId,
    });
  }

  async getLastStatusMessageId(): Promise<number | null> {
    return (await this.read()).lastStatusMessageId;
  }

  async setLastStatusMessageId(messageId: number | null): Promise<void> {
    const state = await this.read();
    state.lastStatusMessageId = messageId;
    await this.write(state);
  }
}
