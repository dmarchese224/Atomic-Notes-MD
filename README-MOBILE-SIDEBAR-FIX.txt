Atomic Notes MD mobile sidebar fix

Issue fixed:
- The visible mobile backdrop element now has actual CSS and stacking behavior.
- Tapping outside the sidebar should close it.
- The sidebar no longer relies on an unused/incorrect backdrop class.

If the old behavior persists after deploy, uninstall/reinstall the app or clear site data so the updated CSS/JS is not served from an older service worker cache.
