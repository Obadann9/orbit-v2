// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NotificationPopover,
  OfferSheet,
  PolicyAccess,
  ThemeModeToggle,
} from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";

describe("theme overlay interactions", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("dark");
    localStorage.clear();
  });

  it("keeps notification, offer, and policy surfaces available after a theme switch", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider defaultTheme="dark" switchable>
        <ThemeModeToggle />
        <NotificationPopover
          notifications={[
            {
              id: 1,
              type: "system",
              title: "Identity update",
              body: "Verification status changed.",
            },
          ]}
          onRead={vi.fn()}
        />
        <OfferSheet
          provider={{
            name: "Playtime",
            mark: "P",
            wallUrl: "https://example.com",
          }}
          close={vi.fn()}
        />
        <PolicyAccess />
      </ThemeProvider>
    );

    expect(screen.getByText("Notifications")).toBeTruthy();
    expect(screen.getByText("Identity update")).toBeTruthy();
    expect(screen.getByText("Playtime")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /terms & policy/i }));
    expect(
      screen.getByRole("dialog", { name: /usage & privacy/i })
    ).toBeTruthy();

    await user.click(screen.getByRole("switch", { name: /dark mode/i }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(screen.getByText("Notifications")).toBeTruthy();
    expect(screen.getByText("Playtime")).toBeTruthy();
    expect(
      screen.getByRole("dialog", { name: /usage & privacy/i })
    ).toBeTruthy();
  });
});
