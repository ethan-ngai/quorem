import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoticeRegion, PersistentNotice } from "./PersistentNotice";
import { SaveIndicator } from "../features/editor/components/SaveIndicator";

describe("persistent feedback", () => {
  it("reserves a slot without a focusable control or recovery action when healthy", () => {
    const html = renderToStaticMarkup(
      <PersistentNotice actions={[{ label: "Retry", onClick() {} }]} />,
    );
    expect(html).toContain('class="persistent-notice"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Retry");
  });

  it("links local content to the full error without putting a banner in flow", () => {
    const html = renderToStaticMarkup(
      <NoticeRegion id="save-error" message="Your edits are still here." label="Save failed">
        <input aria-label="Title" />
      </NoticeRegion>,
    );
    expect(html).toContain('aria-describedby="save-error"');
    expect(html).toContain('id="save-error"');
    expect(html).toContain("Your edits are still here.");
    expect(html).toContain('aria-label="Save failed"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("<p");
  });

  it("deduplicates repeated issues and bounds the visible count", () => {
    const message = Array.from({ length: 12 }, (_, index) => `Issue ${index}`);
    const html = renderToStaticMarkup(<PersistentNotice message={[...message, message[0], ""]} />);
    expect(html).toContain("Needs attention (12 issues)");
    expect(html).toContain("9+");
    expect(html.match(/Issue 0/g)).toHaveLength(1);
  });

  it("keeps the save slot mounted through routine save states", () => {
    for (const state of ["saved", "dirty", "saving"] as const) {
      const html = renderToStaticMarkup(<SaveIndicator state={state} />);
      expect(html).toContain('class="persistent-notice"');
      expect(html).not.toContain("Browser save failed");
      expect(html).not.toContain("<button");
    }
    const html = renderToStaticMarkup(<SaveIndicator state="error" />);
    expect(html).toContain("Browser save failed");
    expect(html).toContain("Retry saving before leaving.");
  });
});
