import { it } from "vitest";
import { assertDifferentialVectors } from "./differential.ts";
it("matches Go edge vectors", assertDifferentialVectors);
