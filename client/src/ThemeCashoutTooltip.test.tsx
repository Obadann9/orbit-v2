// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      orbit: {
        wallet: { invalidate: vi.fn() },
        notifications: { invalidate: vi.fn() },
      },
    }),
    orbit: {
      withdraw: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
    },
  },
}));

import {
  CashOut,
  CHART_TOOLTIP_PROPS,
  CHART_TOOLTIP_STYLE,
  ThemeModeToggle,
} from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";

describe("cash-out and chart tooltip theme interactions", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("dark");
    localStorage.clear();
  });

  it("keeps CashOut and the chart tooltip surface available after switching presentation", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider defaultTheme="dark" switchable>
        <ThemeModeToggle />
        <CashOut wallet={{ balance: 8000 }} close={vi.fn()} />
        <div data-testid="chart-tooltip" style={CHART_TOOLTIP_STYLE}>
          Chart tooltip
        </div>
      </ThemeProvider>
    );

    expect(screen.getByRole("heading", { name: /cash out/i })).toBeTruthy();
    const tooltip = screen.getByTestId("chart-tooltip");
    expect(tooltip.style.background).toBe("var(--chart-tooltip-bg)");
    expect(CHART_TOOLTIP_PROPS.contentStyle).toBe(CHART_TOOLTIP_STYLE);

    await user.click(screen.getByRole("switch", { name: /dark mode/i }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(screen.getByRole("heading", { name: /cash out/i })).toBeTruthy();
    expect(tooltip.style.color).toBe("var(--ink)");
  });
});
