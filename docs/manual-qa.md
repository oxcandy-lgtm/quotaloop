# Manual QA

## Web

- Complete onboarding and confirm automation remains off.
- Check every route at 1440x900, 1024x768, 768x1024, 390x844, and 360x800.
- Run the demo action and confirm one structured history record appears.
- Add and remove a synthetic subscription.
- Test light, dark, keyboard focus, reduced motion, empty states, and the safety drawer.

## Desktop

- Verify menu bar or tray presence, show/hide, repeated click, dashboard open, and quit.
- Test notification permission and a local test notification.
- Verify sleep/resume causes scheduler reevaluation without duplicate actions.
- Confirm fixed CLI detection does not access a repository or invoke a shell.
- Verify the native tray menu contains Open QuotaLoop, Refresh providers, Pause/resume automation, and Quit; left click toggles the hidden window.
- Verify the tray application starts hidden, closing hides it, and the macOS build uses accessory activation.
