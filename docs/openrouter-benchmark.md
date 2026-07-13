# OpenRouter free-model benchmark

QuotaLoop's OpenRouter mode is an explicit, local-only Model Lab workflow. It
fetches the public model catalog and accepts only models whose prompt and
completion prices are exactly zero. `openrouter/free` and `openrouter/auto`
router aliases are excluded; paid models are rejected again immediately before
execution.

## Credentials

The API key is entered only in Settings → Advanced / Safety → API Connections.
The native Tauri command stores it in the macOS Keychain or Windows Credential
Manager. Environment fallback (`OPENROUTER_API_KEY`) is read-only and useful
for a local smoke test. The key is never included in Desktop snapshots,
localStorage, JSON benchmark state, logs, or events. There is no Reveal, Copy,
or credential test that sends the key anywhere except the fixed OpenRouter
endpoint.

## Runs

The immutable manifest is `quotaloop.openrouter.free-benchmark.v1` and contains
four Japanese, four English, and four coding cases. A run is manual, uses one
native runner with concurrency one and a 3200 ms inter-model delay, and stores
only bounded results and the catalog hash. Pause, resume, cancel, retry, and
restart recovery are deterministic; an in-flight model is not duplicated after
restart. There are no background runs, paid-model fallback, cloud sync, or LLM
judge.

All live values are labeled `LIVE / OPENROUTER`. Synthetic fixtures remain
offline and are not mixed with live results. Local data reset removes the
catalog, run state, and result snapshots as part of the authority-owned reset.

CI uses mock native responses and never contacts OpenRouter. A live smoke is
optional and is reported as `skipped_no_key` when no local key or environment
key is present.
