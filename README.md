# QuotaLoop

QuotaLoop is a local-first dashboard for understanding AI service availability, scheduling safe fixed actions, and keeping a private activity history.

> Beta status: the product includes demo and manual providers. Local CLI adapters expose only capabilities that can be verified safely; unavailable quota values are never estimated.

## Features

- Responsive web dashboard and installable PWA
- macOS menu bar and Windows tray desktop shell
- Capability-based provider catalog
- Local automation policies, initially disabled
- Local execution history, signals, and subscription records
- Light, dark, and system themes
- Public-safety checks using synthetic fixtures

## Development

Requirements: Node.js 22+, pnpm 11+, and Rust stable for the desktop shell.

```sh
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm safety
```

Desktop development:

```sh
pnpm --filter @quotaloop/desktop tauri dev
```

QuotaLoop does not read repositories, accept arbitrary shell commands, or upload credentials. See [Privacy](PRIVACY.md), [Security](SECURITY.md), and [Public Safety](PUBLIC_SAFETY.md).
