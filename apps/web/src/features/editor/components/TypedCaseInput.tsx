import { innerType, parseTypedField } from "../customCases";

function formatGuide(type: string): string {
  if (type === "str") return "Plain text; no quotes.";
  if (type === "int") return "Integer from -2,147,483,648 to 2,147,483,647.";
  if (type === "float") return "Finite number, e.g. 1.25.";
  if (type === "bool") return "Boolean value.";
  if (type === "ListNode") return "Values in order, e.g. [1, 2, 3]. Empty: [] or null.";
  if (type === "TreeNode")
    return "Level order with null gaps, e.g. [1, null, 2, 3]. Empty: [] or null.";
  const optional = innerType(type, "optional");
  if (optional)
    return `JSON ${optional} or null${optional === "str" ? "; strings need double quotes" : ""}.`;
  if (innerType(type, "list"))
    return `JSON array of ${innerType(type, "list")}, e.g. ${innerType(innerType(type, "list")!, "list") ? "[[1, 2], [3]]" : innerType(type, "list") === "str" ? '["a", "b"]' : "[1, 2, 3]"}.`;
  return "JSON value; requires a registered server codec.";
}

export function TypedCaseInput({
  id,
  name,
  type,
  value,
  onChange,
}: {
  id: string;
  name: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
}) {
  let error: string | undefined;
  try {
    parseTypedField(type, value);
  } catch (cause) {
    error = (cause as Error).message;
  }
  const descriptionId = `${id}-format`;
  const errorId = `${id}-error`;
  const props = {
    id,
    value,
    "aria-invalid": !!error,
    "aria-describedby": `${descriptionId}${error ? ` ${errorId}` : ""}`,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
  };
  return (
    <div className="typed-case-field">
      <label htmlFor={id}>
        {name} <span>{type}</span>
      </label>
      {type === "bool" ? (
        <select {...props}>
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      ) : type === "int" || type === "float" ? (
        <input
          {...props}
          type="text"
          inputMode={type === "int" ? "numeric" : "decimal"}
          autoComplete="off"
          spellCheck={false}
        />
      ) : (
        <textarea {...props} rows={type === "str" ? 2 : 3} spellCheck={false} />
      )}
      <p id={descriptionId}>{formatGuide(type)}</p>
      {error && (
        <p id={errorId} className="typed-case-error">
          {error}
        </p>
      )}
    </div>
  );
}
