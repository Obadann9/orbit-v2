// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeModeToggle } from "./App";
import { PolicyAccess } from "./App";
import { THEME_STORAGE_KEY, ThemeProvider } from "./contexts/ThemeContext";

describe("ThemeModeToggle", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("dark");
    localStorage.clear();
  });

  it("switches the global dark class and saves the user preference", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider defaultTheme="dark" switchable>
        <ThemeModeToggle />
      </ThemeProvider>
    );

    const toggle = screen.getByRole("switch", { name: /dark mode/i });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await user.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    await user.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("keeps the in-app policy dialog available while the presentation changes", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider defaultTheme="dark" switchable>
        <ThemeModeToggle />
        <PolicyAccess />
      </ThemeProvider>
    );

    await user.click(screen.getByRole("button", { name: /terms & policy/i }));
    expect(
      screen.getByRole("dialog", { name: /usage & privacy/i })
    ).toBeTruthy();

    await user.click(screen.getByRole("switch", { name: /dark mode/i }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(
      screen.getByRole("dialog", { name: /usage & privacy/i })
    ).toBeTruthy();
  });
});
