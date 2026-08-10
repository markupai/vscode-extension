# Changelog

All notable changes to the Markup AI Lint extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Made sign-in far more discoverable when signed out:
  - The activity bar and Findings panel now show a welcome view with a **Sign In** button
    instead of an empty tree.
  - The Markup AI Lint activity bar icon shows a badge until you sign in.
  - A Markup AI authentication provider registers the account in VS Code's Accounts menu
    (with sign-out), so sign-in also lives where other accounts do.
  - A one-time notification points new users at sign-in on first activation.
  - A "Get Started with Markup AI Lint" walkthrough (sign in → pick a style guide → run a
    check) appears on VS Code's Welcome page after install.
  - The signed-out status bar item now stays visible even when no editor is open.

## [1.0.0] - 2026-07-31

First stable release. No breaking changes for users upgrading from 0.1.x — the version
signals that the extension's feature set and settings are now considered stable.

### Changed

- Updated development dependencies (ESLint, typescript-eslint, Prettier, Vite, Vitest) and
  the pinned GitHub Actions used by CI and the release workflow.

### Security

- Resolved six high-severity advisories in transitive dependencies (`brace-expansion`,
  `fast-uri`, `form-data`, `js-yaml`, `linkify-it`, `undici`).

## [0.1.2] - 2026-07-24

### Changed

- Replaced the marketplace and activity bar icons with the new Markup AI Lint mark, whose
  wavy underline stays legible in the monochrome activity bar.
- Updated runtime and development dependencies.

## [0.1.1] - 2026-07-23

### Changed

- Lowered the minimum required VS Code version to 1.105.1 so the extension installs in Cursor
  and other VS Code-based editors on older engine versions.
- Trimmed the README to marketplace essentials and added a demo GIF.

## [0.1.0] - 2026-06-25

Initial public release.

### Added

- Real-time content analysis with the Markup AI Style Agent — inline diagnostics that underline
  issues in the editor with high / medium / low risk levels.
- Hover explanations, one-click **Apply Fix**, and lightbulb quick-fix actions (Ctrl+. / Cmd+.).
- Risk summary in the status bar (e.g. `2H 3M 11L`), with an optional quality score (0–100) for
  organizations that have numeric scoring enabled.
- Findings panel — a tree view of issues for the active document.
- Folder scanner — check selected files or every file in a folder, with results in a tree.
- Self-contained sign-in (browser or pasted token), sign-out, and style-guide selection; tokens
  are stored in VS Code Secret Storage.
- Settings for enabling/disabling checking, check-on-open, check-on-change, check delay, and the
  active style guide.
- Support for Markdown, plain text, HTML, and DITA/XML documents.
