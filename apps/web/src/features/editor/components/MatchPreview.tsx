/** @file MatchPreview.tsx @description Displays the local 1v1 workspace fixture. @module editor */

/** Static match state previews the workspace without changing solo execution rules. */
export function MatchPreview() {
  return (
    <aside className="match-preview" aria-label="Mock match state">
      <div>
        <strong>1v1 preview</strong>
        <span>24:36 remaining</span>
      </div>
      <p>Opponent connected · solving · best 8/20 tests</p>
      <small>Static fixture. Run and Submit remain solo practice.</small>
    </aside>
  );
}
