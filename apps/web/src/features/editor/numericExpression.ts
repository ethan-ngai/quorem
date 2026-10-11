/** Bounded arithmetic only; no identifiers, calls, or JavaScript evaluation. */
export function acceptsNumericExpression(source: string) {
  return source.length <= 4096 && /^[\d\s.eE+*/%()-]*$/.test(source);
}

export function parseNumericExpression(source: string): number {
  if (!acceptsNumericExpression(source)) throw new Error("Enter a numeric expression.");
  const tokens =
    source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|\*\*|\/\/|[+*/%()-]|\S/g) ?? [];
  if (tokens.length > 1024) throw new Error("Expression exceeds 1,024 tokens.");
  let position = 0;
  function expression(minimum = 0, depth = 0): number {
    if (depth > 64) throw new Error("Expression nesting exceeds 64 levels.");
    const token = tokens[position++];
    let value: number;
    if (token === "+" || token === "-") {
      value = expression(30, depth + 1) * (token === "-" ? -1 : 1);
    } else if (token === "(") {
      value = expression(0, depth + 1);
      if (tokens[position++] !== ")") throw new Error("Close the expression parenthesis.");
    } else {
      if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token))
        throw new Error("Enter a numeric expression.");
      value = Number(token);
      if (Number.isInteger(value) && !Number.isSafeInteger(value))
        throw new Error("Integer exceeds exact arithmetic range.");
    }
    while (position < tokens.length) {
      const operator = tokens[position]!;
      const precedence =
        operator === "**"
          ? 40
          : ["*", "/", "//", "%"].includes(operator)
            ? 20
            : ["+", "-"].includes(operator)
              ? 10
              : -1;
      if (precedence < minimum) break;
      position++;
      const right = expression(operator === "**" ? precedence : precedence + 1, depth + 1);
      if (operator === "**" && Math.abs(right) > 1024) throw new Error("Exponent exceeds 1,024.");
      if (["/", "//", "%"].includes(operator) && right === 0) throw new Error("Division by zero.");
      switch (operator) {
        case "+":
          value += right;
          break;
        case "-":
          value -= right;
          break;
        case "*":
          value *= right;
          break;
        case "/":
          value /= right;
          break;
        case "//":
          value = Math.floor(value / right);
          break;
        case "%":
          value = ((value % right) + right) % right;
          break;
        case "**":
          value **= right;
          break;
      }
      if (!Number.isFinite(value)) throw new Error("Enter a finite number.");
      if (Number.isInteger(value) && !Number.isSafeInteger(value))
        throw new Error("Integer exceeds exact arithmetic range.");
    }
    if (!Number.isFinite(value)) throw new Error("Enter a finite number.");
    return value;
  }
  const value = expression();
  if (position !== tokens.length) throw new Error("Enter a numeric expression.");
  return value;
}
