import { expect, it } from "vitest";
import { StreamingJsonReader, decodeUtf8Chunks } from "@quorem/questions";
import { scanLegacyInterviewFixture } from "./published-sidecars.ts";
it("scans nested public and hidden case ranges across UTF-8 boundaries", async () => {
  const raw =
    '{"problem":{"examples":[],"odyssey":{"levels":[{"examples":[{"args":["é\\u0000"],"calls":[{"methodName":"m","args":[9007199254740993],"secret":"hidden"}],"explanation":"a"}]}]}},"odysseyHiddenCases":[[{"args":["secret"],"expected":1}]]}';
  const input = new TextEncoder().encode(raw);
  async function* pages() {
    for (let i = 0; i < input.length; i += 3) yield input.subarray(i, i + 3);
  }
  const spans = await scanLegacyInterviewFixture(
    new StreamingJsonReader(decodeUtf8Chunks(pages())[Symbol.asyncIterator]()),
  );
  expect(spans.cases.map(({ channel, stage, ordinal }) => ({ channel, stage, ordinal }))).toEqual([
    { channel: "example", stage: 1, ordinal: 0 },
    { channel: "hidden", stage: 1, ordinal: 0 },
  ]);
  for (const entry of spans.cases)
    expect(
      JSON.parse(new TextDecoder().decode(input.subarray(entry.start, entry.start + entry.length))),
    ).toBeTruthy();
});
