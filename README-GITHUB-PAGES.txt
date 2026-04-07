Atomic Notes MD — GitHub Pages notes

This build keeps your existing app structure intact and only makes path handling safer for GitHub Pages.

What changed:
- Service worker registration now resolves sw.js relative to the current page URL.
- manifest.json now includes "scope": "./".
- This is safer for repo-based GitHub Pages URLs like:
  https://username.github.io/atomic-notes-md/

Deploy notes:
1. Upload the full contents of this folder to your GitHub repository.
2. Enable GitHub Pages from the repository root.
3. After deployment, verify these URLs work:
   - https://username.github.io/atomic-notes-md/
   - https://username.github.io/atomic-notes-md/sw.js
   - https://username.github.io/atomic-notes-md/manifest.json
4. Open DevTools > Application > Service Workers and confirm the worker is registered.
5. Then retry PWABuilder using the live GitHub Pages URL.
