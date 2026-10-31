/** @file projected-stream.ts @description Incremental public projection of private test inputs. @module judging */
import { LegacyJsonReader } from "./legacy-json.ts";
export async function* projectedObject(
  input: LegacyJsonReader,
  allowed: Set<string>,
  calls = false,
): AsyncGenerator<string> {
  await input.expect("{");
  yield "{";
  let first = true;
  while ((await input.peek()) !== "}") {
    const key = JSON.parse(await input.value()) as string;
    await input.expect(":");
    if (allowed.has(key)) {
      yield (first ? "" : ",") + JSON.stringify(key) + ":";
      first = false;
      if (calls && key === "calls") {
        if ((await input.peek()) === "n") {
          if ((await input.value()) !== "null") throw new Error("Invalid calls");
          yield "[]";
        } else {
          await input.expect("[");
          yield "[";
          let index = 0;
          while ((await input.peek()) !== "]") {
            if (index++) yield ",";
            yield* projectedObject(input, new Set(["methodName", "args", "expected"]));
            if ((await input.peek()) === ",") await input.expect(",");
            else break;
          }
          await input.expect("]");
          yield "]";
        }
      } else yield* input.valueChunks();
    } else
      for await (const _ of input.valueChunks()) {
        /* skip unprojected fields */
      }
    if ((await input.peek()) === ",") await input.expect(",");
    else break;
  }
  await input.expect("}");
  yield "}";
}
