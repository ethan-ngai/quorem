/** @file ComplexityDetails.tsx @description Shared authored complexity costs and notes. @module editor */
import type { ApproachComplexity } from "@quorem/contracts";
import { StatementMarkdown, inlineStatement } from "./StatementMarkdown";
import { complexityMath, complexityNotesMarkup } from "../complexityMarkup";
import { Clock3, MemoryStick } from "lucide-react";
import { Tooltip } from "../../../ui/Tooltip";
import "./editorial.css";
type Complexity = Pick<
  ApproachComplexity,
  "timeComplexity" | "spaceComplexity" | "complexityNotes"
>;
export function ComplexityDetails({ value }: { value: Complexity }) {
  return (
    <div className="editorial-complexity">
      <dl>
        <div>
          <dt>
            <Tooltip content="Time complexity">
              <span tabIndex={0} role="img" aria-label="Time complexity">
                <Clock3 size={15} aria-hidden="true" />
              </span>
            </Tooltip>
          </dt>
          <dd>
            {value.timeComplexity
              ? inlineStatement(complexityMath(value.timeComplexity))
              : "Not specified"}
          </dd>
        </div>
        <div>
          <dt>
            <Tooltip content="Auxiliary space">
              <span tabIndex={0} role="img" aria-label="Auxiliary space">
                <MemoryStick size={15} aria-hidden="true" />
              </span>
            </Tooltip>
          </dt>
          <dd>
            {value.spaceComplexity
              ? inlineStatement(complexityMath(value.spaceComplexity))
              : "Not specified"}
          </dd>
        </div>
      </dl>
      {value.complexityNotes && (
        <div className="editorial-complexity-notes">
          <StatementMarkdown
            source={complexityNotesMarkup(
              value.complexityNotes,
              value.timeComplexity,
              value.spaceComplexity,
            )}
          />
        </div>
      )}
    </div>
  );
}
