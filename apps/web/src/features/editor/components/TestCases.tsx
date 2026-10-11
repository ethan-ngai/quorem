/** @file TestCases.tsx @description Selectable public examples and editable custom Run input. @module editor */
import type { ProblemVersion } from "@quorem/contracts";
import { useState } from "react";

/** Shows one named example at a time; custom input keeps the typed JSON admission contract. */
export function TestCases({
  problem,
  customMode,
  onCustomModeChange,
  customCasesText,
  onCustomCasesChange,
}: {
  problem: ProblemVersion;
  customMode: boolean;
  onCustomModeChange: (custom: boolean) => void;
  customCasesText: string;
  onCustomCasesChange: (source: string) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const activeIndex = Math.min(selectedIndex, Math.max(0, problem.examples.length - 1));
  const example = problem.examples[activeIndex];
  return (
    <div className="test-cases-content">
      <div className="case-selectors" aria-label="Select test case">
        {problem.examples.map((_example, index) => (
          <button
            key={index}
            className="case-selector"
            aria-pressed={!customMode && activeIndex === index}
            onClick={() => {
              setSelectedIndex(index);
              onCustomModeChange(false);
            }}
          >
            Case {index + 1}
          </button>
        ))}
        <button
          className="case-selector custom-case-selector"
          aria-pressed={customMode}
          onClick={() => onCustomModeChange(true)}
        >
          Custom input
        </button>
      </div>
      {customMode ? (
        <div className="custom-input">
          <label htmlFor="custom-cases">Custom cases</label>
          <textarea
            id="custom-cases"
            aria-label="Custom cases as JSON"
            spellCheck={false}
            value={customCasesText}
            onChange={(event) => onCustomCasesChange(event.target.value)}
          />
          <p>
            Use <code>[&#123;"args": [1, "text"], "expected": 2&#125;]</code>. Expected output is
            optional.
          </p>
        </div>
      ) : example ? (
        <div className="case-details">
          {example.args.map((value, index) => (
            <div className="case-detail" key={index}>
              <span>{problem.signature.parameters[index]?.name ?? `arg${index + 1}`}</span>
              <code>{JSON.stringify(value)}</code>
            </div>
          ))}
          <div className="case-detail">
            <span>Expected output</span>
            <code>{JSON.stringify(example.expected)}</code>
          </div>
        </div>
      ) : (
        <p className="result-message">No public examples available.</p>
      )}
    </div>
  );
}
