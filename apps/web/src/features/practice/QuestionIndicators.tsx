import { CircleCheck, LockKeyhole } from "lucide-react";
import { OdysseyIcon } from "../../ui/OdysseyIcon";

export function QuestionIndicators({
  privateQuestion,
  odyssey,
  solved,
}: {
  privateQuestion: boolean;
  odyssey?: boolean;
  solved?: boolean;
}) {
  return (
    <span className="practice-indicators">
      {solved && (
        <span className="practice-solved" role="img" aria-label="Solved" title="Solved">
          <CircleCheck size={16} aria-hidden="true" />
        </span>
      )}
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
