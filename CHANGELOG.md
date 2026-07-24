# Changelog

All notable changes to the Markup AI Lint extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
