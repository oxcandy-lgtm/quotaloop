# Provider Model

Adapters report granular integration levels: full, quota read, run only, detect only, manual, mock, or unsupported. Capabilities are explicit. Zero is never used to represent missing data, and stale data is labeled.

Version 0.1 includes a complete synthetic Codex demo adapter and fixed-command installation detection for Codex, Claude Code, Gemini CLI, and OpenCode. No verified public local quota source was found in the implementation scope, so real quota reads remain unavailable rather than estimated.

Desktop detection runs only a fixed executable allowlist (`codex`, `claude`, `gemini`, `opencode`) without a shell. Each probe has a short timeout, bounded output capture, and returns a structured installed/not-installed/timeout/failed/unsupported state. Full command output is never persisted.
