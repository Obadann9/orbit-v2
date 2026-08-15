import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const dialog = readFileSync(
  new URL("./components/ManusDialog.tsx", import.meta.url),
  "utf8"
);

describe("theme surface audit", () => {
  it("covers Orbit popovers, sheets, modals, and chart surfaces in light mode", () => {
    [
      ".notification-popover",
      ".offer-sheet",
      ".cashout-modal",
      ".policy-sheet",
      ".chart-card",
      ".kyc-status-card",
    ].forEach(selector => expect(css).toContain(`html:not(.dark) ${selector}`));
  });

  it("avoids fixed chart tooltip colors and uses theme variables in login dialog", () => {
    expect(app).not.toContain('background: "#17152b"');
    expect(app).toContain("{...CHART_TOOLTIP_PROPS}");
    expect(dialog).toContain("bg-[var(--panel)]");
    expect(dialog).toContain("text-[var(--ink)]");
  });
});
