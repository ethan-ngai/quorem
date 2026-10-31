/** @file legacy-json.ts @description Incremental reader for privileged legacy result normalization. @module judging */
/** One token is buffered at a time; callers split arrays into individual values. */
export class LegacyJsonReader {
  private buffer = "";
  private index = 0;
  private done = false;
  private readonly chunks: AsyncIterator<string>;
  constructor(chunks: AsyncIterator<string>) {
    this.chunks = chunks;
  }
  private async ensure(): Promise<boolean> {
    while (this.index === this.buffer.length && !this.done) {
      const next = await this.chunks.next();
      this.done = !!next.done;
      this.buffer = next.value ?? "";
      this.index = 0;
    }
    return this.index < this.buffer.length;
  }
  async peek(): Promise<string> {
    while (await this.ensure()) {
      const char = this.buffer[this.index];
      if (!/\s/.test(char)) return char;
      this.index++;
    }
    return "";
  }
  async expect(expected: string): Promise<void> {
    if ((await this.peek()) !== expected) throw new Error("Invalid legacy result JSON");
    this.index++;
  }
  async *valueChunks(): AsyncGenerator<string> {
    const first = await this.peek();
    if (!first) throw new Error("Truncated result JSON");
    const composite = first === "{" || first === "[",
      quoted = first === '"';
    let depth = 0,
      inString = false,
      escaped = false,
      started = false;
    while (await this.ensure()) {
      const start = this.index;
      while (this.index < this.buffer.length) {
        const c = this.buffer[this.index];
        if (!started) {
          started = true;
          if (composite) depth = 1;
          if (quoted) inString = true;
          this.index++;
          continue;
        }
        if (inString) {
          this.index++;
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') {
            inString = false;
            if (quoted && !composite) {
              yield this.buffer.slice(start, this.index);
              return;
            }
          }
          continue;
        }
        if (c === '"') {
          inString = true;
          this.index++;
          continue;
        }
        if (composite && (c === "{" || c === "[")) {
          depth++;
          this.index++;
          continue;
        }
        if (composite && (c === "}" || c === "]")) {
          depth--;
          this.index++;
          if (!depth) {
            yield this.buffer.slice(start, this.index);
            return;
          }
          continue;
        }
        if (!composite && (c === "," || c === "]" || c === "}" || /\s/.test(c))) {
          const part = this.buffer.slice(start, this.index);
          if (part) yield part;
          return;
        }
        this.index++;
      }
      const part = this.buffer.slice(start, this.index);
      if (part) yield part;
    }
    if (!composite && !quoted && started) return;
    throw new Error("Truncated result JSON");
  }
  async value(capture = true): Promise<string> {
    const parts: string[] = [];
    for await (const part of this.valueChunks()) if (capture) parts.push(part);
    return parts.join("");
  }
}
