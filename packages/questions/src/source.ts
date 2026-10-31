/** @file source.ts @description Source text validity for authoring and execution. @module questions */
/** Reject invalid UTF-16, NUL and UTF-8 source beyond the execution limit. */
export function validSource(source: string): boolean {
  return (
    new TextEncoder().encode(source).length <= 65536 &&
    !source.includes("\0") &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(source)
  );
}
