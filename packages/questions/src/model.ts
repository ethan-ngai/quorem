/** @file model.ts @description Canonical question contract types. @module questions */
import type { components } from "@quorem/contracts/schema";

export type QuestionContent = components["schemas"]["QuestionContent"];
export type QuestionProblem = components["schemas"]["QuestionProblem"];
export type Signature = components["schemas"]["Signature"];
export type Constraint = components["schemas"]["Constraint"];
export type ConstraintTarget = components["schemas"]["ConstraintTarget"];
export type InputPresetConfig = components["schemas"]["InputPresetConfig"];
export type ExecutionLimits = components["schemas"]["ExecutionLimits"];
