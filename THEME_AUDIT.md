# Theme Surface Audit

## Scope

Orbit starts in **dark mode** and stores the chosen presentation in browser storage under `orbit-theme`. The user can change the setting from **Me → Dark mode**. The `.dark` class controls the default deep-space appearance; removing it switches to the light palette.

| Surface                                                                                                   | Theme mechanism                                                                         | Verification                                                                |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| App shell, header, bottom navigation, rewards, wallet, profile, and admin views                           | Shared color tokens in `client/src/index.css`                                           | `ThemeModeToggle.test.tsx` checks global class and stored preference.       |
| Notification popover, offer sheet, cash-out modal, policy sheet, KYC cards, admin charts, and audit cards | Light-mode surface overrides in `index.css`                                             | `themeSurfaces.test.tsx` checks every primary selector.                     |
| Recharts grids, axis ticks, bars, gradients, and tooltips                                                 | `--chart-*`, `--lime`, `--indigo`, and `--ink` variables used in `App.tsx`              | `themeSurfaces.test.tsx` prevents restoration of fixed tooltip backgrounds. |
| Manus login dialog                                                                                        | `--panel`, `--panel-2`, `--ink`, `--muted`, and `--line` variables in `ManusDialog.tsx` | `themeSurfaces.test.tsx` checks token-based classes.                        |

## Intentional Technical Exceptions

The embedded offerwall frame uses a light browser surface because it hosts third-party content; Orbit cannot safely restyle its cross-origin document. The CSS colors in `components/ui/chart.tsx` are attribute selectors for Recharts defaults, not visible hard-coded UI surfaces. Unlinked component-showcase pages and generic component primitives rely on semantic Tailwind tokens and are not part of the Orbit navigation flow.

## Complete Explicit-Color File Inventory

The source audit searches every `*.ts`, `*.tsx`, and `*.css` file under `client/src` for hexadecimal and `rgba()` color values. The only matching production files are listed below; test files merely contain assertions about those values.

| File                                    | Finding                                       | Resolution or exception                                                                                                                                                                                                                                                   |
| --------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/src/index.css`                  | Orbit's actual visual surfaces and gradients. | All user-facing foreground, background, border, navigation, sheet, popover, card, chart, and modal surfaces use shared tokens. `html:not(.dark)` defines the light palette and overrides dark-only surfaces. The third-party offerwall frame remains intentionally light. |
| `client/src/components/ManusDialog.tsx` | Login dialog used by the template.            | Converted to `--panel`, `--panel-2`, `--ink`, `--muted`, and `--line` tokens.                                                                                                                                                                                             |
| `client/src/components/ui/chart.tsx`    | Recharts SVG attribute selectors.             | Technical exception: these are selector guards for library fallback attributes, rather than authored UI colors. Orbit's visible chart colors and tooltips are defined by theme variables in `App.tsx` and `index.css`.                                                    |
| `client/src/contexts/ThemeContext.tsx`  | Browser theme-color metadata values.          | Intentional metadata values for browser chrome; they change together with the active presentation.                                                                                                                                                                        |
| `client/src/themeSurfaces.test.tsx`     | Test assertions.                              | Not production UI.                                                                                                                                                                                                                                                        |

All other client source files contain no hexadecimal or `rgba()` color literal under this audit rule.
