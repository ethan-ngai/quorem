/** @file local-encoder.ts @description Pinned pretrained MiniLM running on the maintenance host CPU. @module problems */
import { embeddingSpec } from "../../modules/problems/recommendations/model.ts";
import { pipeline, env } from "@huggingface/transformers";
import type { QuestionEncoder } from "../../modules/problems/recommendations/ports.ts";
export async function localQuestionEncoder(cacheDir?: string): Promise<QuestionEncoder> {
  if (cacheDir) env.cacheDir = cacheDir;
  const extract = await pipeline("feature-extraction", "onnx-community/all-MiniLM-L6-v2-ONNX", {
    revision: embeddingSpec.revision,
    dtype: embeddingSpec.precision,
    device: "cpu",
  });
  return {
    async encode(texts) {
      const result = await extract([...texts], { pooling: embeddingSpec.pooling, normalize: true });
      return result.tolist() as number[][];
    },
  };
}
