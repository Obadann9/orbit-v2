// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PolicyAccess } from "./App";

describe("PolicyAccess", () => {
  it("opens and closes the policy sheet from the Terms & policy entry", async () => {
    const user = userEvent.setup();
    render(<PolicyAccess />);

    await user.click(screen.getByRole("button", { name: /terms & policy/i }));
    expect(
      screen.getByRole("dialog", { name: /usage & privacy/i })
    ).toBeTruthy();
    expect(screen.getByText("Responsible use")).toBeTruthy();
    expect(screen.getByText("Privacy and account data")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /close policies/i }));
    expect(
      screen.queryByRole("dialog", { name: /usage & privacy/i })
    ).toBeNull();
  });
});
