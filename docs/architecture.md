# Architecture

QuotaLoop separates provider-specific capabilities from shared UI and automation decisions. The web application never invokes local CLIs directly. The Tauri desktop agent exposes a fixed allowlist of detection commands and does not expose a shell bridge.

Local mode stores versioned JSON behind a validated repository interface. Provider failures remain isolated and unknown quota values remain unavailable.
