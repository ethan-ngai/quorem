/** @file array-stream.ts @description Forward-only access to bounded streamed JSON array values. @module judging */
import { StreamingJsonReader } from "@quorem/questions";

/** Callers consume each selected value before advancing; skipped values never accumulate. */
export class ResultArray {
  private readonly input: StreamingJsonReader;
  private next = 0;
  private started = false;
  private readonly authorize: () => Promise<void>;

  constructor(chunks: AsyncIterator<string>, authorize: () => Promise<void>) {
    this.input = new StreamingJsonReader(chunks);
    this.authorize = authorize;
  }

  async at(ordinal: number): Promise<StreamingJsonReader> {
    if (!Number.isSafeInteger(ordinal) || ordinal < this.next)
      throw new Error("Result array ordinals must advance");
    await this.authorize();
    if (!this.started) {
      await this.input.expect("[");
      this.started = true;
    } else await this.input.expect(",");
    while (this.next < ordinal) {
      await this.input.value(false);
      await this.input.expect(",");
      this.next++;
    }
    this.next = ordinal + 1;
    return this.input;
  }

  async close(): Promise<void> {
    await this.input.close();
  }
}
