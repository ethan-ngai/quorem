/** @file public-projection.ts @description Authorized question projection helpers. @module problems */
import { sql, type SQL } from 'drizzle-orm';
import { JsonNumber, parseLosslessJson, stringifyLosslessJson, type JsonValue } from '@quorem/questions';
import type { ProblemActor } from '../../../../modules/problems/model.ts';

/** Requires `p` and `v` aliases; match access is limited to active participants. */
export function visibleProblem(actor: ProblemActor | undefined, match: boolean): SQL {
  const who = actor?.userId ?? '';
  return sql`(p.owner_id IS NULL OR (${who}<>'' AND p.owner_id=${who}) OR (${match} AND ${who}<>'' AND EXISTS(SELECT 1 FROM match_participants mp JOIN matches m ON m.id=mp.match_id WHERE mp.owner_id=${who} AND NOT mp.forfeited AND m.problem_version_id=v.id AND m.state IN ('active','finalizing'))))`;
}
export function jsonObject(value: JsonValue | undefined): { [key: string]: JsonValue } {
  if (!value || typeof value !== 'object' || value instanceof JsonNumber || Array.isArray(value)) throw new Error('invalid public question');
  return value;
}
/** Restores only examples belonging to stages already selected by the caller. */
export function restorePublicExamples(value: { [key: string]: JsonValue }, lossless: Uint8Array | null): void {
  if (lossless?.length) {
    const raw = jsonObject(parseLosslessJson(new TextDecoder('utf-8', { fatal: true }).decode(lossless)));
    const source = jsonObject(raw.problem);
    if ('examples' in value) value.examples = source.examples ?? null;
    if (value.odyssey && source.odyssey) {
      const target = jsonObject(value.odyssey).levels, original = jsonObject(source.odyssey).levels;
      if (Array.isArray(target) && Array.isArray(original)) {
        for (let i = 0; i < target.length && i < original.length; i++) jsonObject(target[i]).examples = jsonObject(original[i]).examples ?? null;
      }
    }
  }
  const retain = (item: { [key: string]: JsonValue }, keys: readonly string[]) => { for (const key of Object.keys(item)) if (!keys.includes(key)) delete item[key]; };
  const clean = (examples: JsonValue | undefined) => {
    if (!Array.isArray(examples)) return;
    for (const example of examples) {
      const item = jsonObject(example);
      retain(item, ['args', 'expected', 'calls', 'explanation']);
      if (Array.isArray(item.calls)) for (const call of item.calls) retain(jsonObject(call), ['methodName', 'args', 'expected']);
      if (item.explanation === '') delete item.explanation;
      if (Array.isArray(item.calls) && item.calls.length === 0) delete item.calls;
    }
  };
  clean(value.examples);
  if (value.odyssey) {
    const levels = jsonObject(value.odyssey).levels;
    if (Array.isArray(levels)) for (const level of levels) {
      const stage = jsonObject(level);
      retain(stage, ['title', 'statementMarkdown', 'methods', 'examples']);
      if (Array.isArray(stage.methods)) for (const methodValue of stage.methods) {
        const method = jsonObject(methodValue);
        retain(method, ['description', 'returns', 'throws', 'outputOrder', 'className', 'methodName', 'parameters', 'returnType']);
        if (Array.isArray(method.throws)) for (const entry of method.throws) retain(jsonObject(entry), ['type', 'description']);
        if (Array.isArray(method.parameters)) for (const parameterValue of method.parameters) {
          const parameter = jsonObject(parameterValue);
          retain(parameter, ['name', 'type', 'description', 'input']);
          if (parameter.input) retain(jsonObject(parameter.input), ['preset', 'placeholder', 'rows']);
        }
      }
      clean(stage.examples);
    }
  }
}
/** Input levels must already be restricted to the authorized unlocked prefix in SQL. */
export function publicOdysseyLevels(unlockedJson: string, losslessStages: Uint8Array | null, unlocked: number): string {
  const levels = parseLosslessJson(unlockedJson);
  if (!Array.isArray(levels) || !Number.isSafeInteger(unlocked) || unlocked < 1 || levels.length !== unlocked) throw new Error('invalid unlocked stages');
  const wrapper: { [key: string]: JsonValue } = { odyssey: { levels } };
  restorePublicExamples(wrapper, losslessStages);
  return stringifyLosslessJson(levels);
}
