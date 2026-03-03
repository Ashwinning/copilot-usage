# Changelog

All notable changes to `@f6n/copilot-usage` are documented in this file.

## 0.1.1 - 2026-03-03

### Fixed
- Fixed PowerShell hook fallback syntax so `sessionEnd` hook capture runs correctly on Windows.
- Treated legacy hook definitions as outdated and automatically reinstalled the newer hook command format.

### Added
- Added interactive terminal fallback capture in the wrapper by running Copilot through a PTY path and parsing usage summary output when hook events do not contain usage.
- Added a spawn fallback path if PTY setup fails.
- Added debug logging fields for capture mode and PTY fallback reason.
- Added parser handling for ANSI/control-sequence-heavy interactive output.
- Added protection against double counting duplicated redraw summary lines.
- Added tests for interactive ANSI summary parsing and redraw dedup behavior.

### Changed
- Added `node-pty` dependency for cross-platform PTY capture support.
