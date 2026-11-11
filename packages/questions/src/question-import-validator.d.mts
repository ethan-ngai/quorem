/** @file question-import-validator.d.mts @description Standalone file validator signature. @module questions */
declare function validate(value: unknown): boolean;
declare namespace validate {
  let errors:
    | readonly {
        instancePath: string;
        keyword: string;
        message?: string;
        params: Record<string, unknown>;
      }[]
    | null
    | undefined;
}
export default validate;
