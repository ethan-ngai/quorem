import { LockKeyhole } from "lucide-react";
import { OdysseyIcon } from "./QuestionTypeFilter";

export function QuestionIndicators({
  privateQuestion,
  odyssey,
}: {
  privateQuestion: boolean;
  odyssey: boolean;
}) {
  return (
    <span className="practice-indicators">
      {privateQuestion && (
        <span role="img" aria-label="Private question" title="Private question">
          <LockKeyhole size={16} aria-hidden="true" />
        </span>
      )}
      {odyssey && (
        <span className="odyssey-indicator" role="img" aria-label="Odyssey" title="Odyssey">
          <OdysseyIcon />
        </span>
      )}
    </span>
  );
}
