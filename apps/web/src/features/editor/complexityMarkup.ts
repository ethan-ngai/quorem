/** @file complexityMarkup.ts @description Math presentation for existing authored complexity text. @module editor */
function expression(source: string) {
  return source
    .trim()
    .replace(/^\$([\s\S]*)\$$/, "$1")
    .replace(/(?<!\\)\b(log|min|max|sqrt)\b/g, "\\$1")
    .replace(/\^(-?\d+)/g, "^{$1}");
}
export function complexityMath(source: string): string {
  return `$${expression(source)}$`;
}

/** Published plain-text notes remain immutable; annotate only their standalone free variables. */
export function complexityNotesMarkup(notes: string, ...costs: string[]): string {
  const variables = new Set(
    costs.flatMap(
      (cost) =>
        expression(cost)
          .replace(/\\[A-Za-z]+/g, "")
          .match(/\b[A-Za-z]\b/g) ?? [],
    ),
  );
  variables.delete("O");
  return notes
    .split(/(\$[^$\n]*\$|`+[^`]*`+)/g)
    .map((part) => {
      if (part.startsWith("$")) return part;
      if (part.startsWith("`")) {
        const name = part.replace(/^`+|`+$/g, "").trim();
        return variables.has(name) ? complexityMath(name) : part;
      }
      return part
        .split(/(O\((?:[^()]|\([^()]*\))*\))/g)
        .map((text) =>
          text.startsWith("O(")
            ? complexityMath(text)
            : text.replace(/\b[A-Za-z]\b/g, (name) =>
                variables.has(name) ? complexityMath(name) : name,
              ),
        )
        .join("");
    })
    .join("");
}
