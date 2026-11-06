declare function validate(value: unknown): boolean;
declare namespace validate {
  let errors: { instancePath: string; message?: string }[] | null;
}
export default validate;
