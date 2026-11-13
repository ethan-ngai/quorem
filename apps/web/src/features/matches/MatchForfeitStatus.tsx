import { Icon } from "../../ui/Icon";
import { Tooltip } from "../../ui/Tooltip";

export function MatchForfeitStatus() {
  return (
    <Tooltip content="Forfeited">
      <span
        className="match-forfeit-status motion-reveal"
        role="img"
        aria-label="Forfeited"
        tabIndex={0}
      >
        <Icon name="flag" width={14} height={14} />
      </span>
    </Tooltip>
  );
}
