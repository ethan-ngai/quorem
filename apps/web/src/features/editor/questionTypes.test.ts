import { expect, it } from "vitest";
import { questionTypeName, questionValue } from "./questionTypes";
import { validateTypedValue } from "./typedValues";
it("renders language literals without modifying string contents", () => {
  expect(questionValue([null, true, false, "null True false"], "python")).toBe(
    '[None,True,False,"null True false"]',
  );
  expect(questionValue([null, true], "java")).toBe("[null,true]");
  expect(questionValue(null, "typescript", "void")).toBe("undefined");
});
it("maps shared lists and arrays to each language", () => {
  expect(questionTypeName("list<int>", "java")).toBe("java.util.List<Integer>");
  expect(questionTypeName("array<int>", "java")).toBe("int[]");
  for (const type of ["list<int>", "array<int>"])
    expect(questionTypeName(type, "python")).toBe("list[int]");
  expect(questionTypeName("optional<array<str>>", "python")).toBe("list[str] | None");
  expect(questionTypeName("void", "python")).toBe("None");
  expect(questionTypeName("list<optional<int>>", "java")).toBe("java.util.List<Integer>");
  expect(() => validateTypedValue("array<optional<int>>", [1, null])).not.toThrow();
  expect(() => validateTypedValue("array<int>", [null])).toThrow();
});
