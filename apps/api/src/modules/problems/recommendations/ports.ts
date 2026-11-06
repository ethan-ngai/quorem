/** @file ports.ts @description Local content encoder contract. @module problems */
export interface QuestionEncoder {
  encode(texts: readonly string[]): Promise<number[][]>;
}
