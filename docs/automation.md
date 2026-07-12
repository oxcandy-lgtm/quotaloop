# Automation

Automation is disabled by default. A pure decision function checks provider availability, verified quota, authentication, freshness, active hours, thresholds, daily limits, duplicate keys, and current execution state.

Only fixed actions are permitted. Arbitrary prompts, shell commands, repository selection, sandbox bypass, unlimited retry, and background web execution are excluded.

Active hours and daily limits use the policy's IANA timezone. `24:00` means the end of the local day; equal start/end values mean an all-day window, and overnight windows are supported. Invalid times or zones fail closed. Idempotency keys use an ISO UTC minute bucket so retries remain timezone-independent.
