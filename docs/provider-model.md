# Provider Model

Adapters report granular integration levels: full, quota read, run only, detect only, manual, mock, or unsupported. Capabilities are explicit. Zero is never used to represent missing data, and stale data is labeled.

Version 0.1 includes a complete synthetic Codex demo adapter and fixed-command installation detection for Codex, Claude Code, Gemini CLI, and OpenCode. No verified public local quota source was found in the implementation scope, so real quota reads remain unavailable rather than estimated.
