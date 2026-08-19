import { Injectable } from '@nestjs/common';

export interface ParseStatus {
  running: boolean;
  url: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  round: number;
  productsFound: number;
  error: string | null;
  stoppedByUser: boolean;
}

// In-memory only: a parse is tied to the live HTTP request driving it, so
// if the process restarts nothing is actually "running" anymore either —
// there's nothing to recover from a file on disk.
@Injectable()
export class ParseStatusService {
  private status: ParseStatus = {
    running: false,
    url: null,
    startedAt: null,
    finishedAt: null,
    round: 0,
    productsFound: 0,
    error: null,
    stoppedByUser: false,
  };

  private stopRequested = false;

  start(url: string) {
    this.stopRequested = false;
    this.status = {
      running: true,
      url,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      round: 0,
      productsFound: 0,
      error: null,
      stoppedByUser: false,
    };
  }

  progress(round: number, productsFound: number) {
    if (!this.status.running) return;
    this.status.round = round;
    this.status.productsFound = productsFound;
  }

  finish() {
    this.status.running = false;
    this.status.finishedAt = new Date().toISOString();
    this.status.stoppedByUser = this.stopRequested;
  }

  fail(error: string) {
    this.status.running = false;
    this.status.finishedAt = new Date().toISOString();
    this.status.error = error;
  }

  // The scroll loop (product-parser.service.ts) polls this once per round
  // and breaks out gracefully — there's no way to forcibly interrupt a
  // Playwright operation already in flight, so "stop" takes effect at the
  // next round boundary, not instantly.
  requestStop() {
    if (this.status.running) this.stopRequested = true;
  }

  isStopRequested(): boolean {
    return this.stopRequested;
  }

  getStatus(): ParseStatus {
    return { ...this.status };
  }
}
