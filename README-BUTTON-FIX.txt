Atomic Notes MD button fix

Root cause fixed:
- Navigation buttons were calling switchView(), but switchView was trying to activate the view using an invalid selector helper.
- That caused taps to appear broken.
- New Card order was also adjusted so the sidebar closes first on mobile.

Also included:
- service worker cache version bumped to v3 so the new JS is more likely to replace the old cached app after redeploy.
