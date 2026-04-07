Atomic Notes MD — Service Worker troubleshooting for PWABuilder

If PWABuilder still cannot detect the service worker:

1. Confirm these exact URLs load in the browser with HTTP 200:
   - https://YOUR-URL/sw.js
   - https://YOUR-URL/manifest.json

2. Open DevTools in Chrome:
   Application > Service Workers
   - Confirm a service worker is registered
   - Confirm its scope matches your app path

3. Hard refresh once after deployment.

4. In the browser console, look for:
   - "SW registered: ..."
   - or any registration/fetch error

5. If using GitHub Pages project URLs, make sure the repo publishes the full folder contents including sw.js in the same published directory as index.html.

6. If needed, copy sw.js to both the repo root and the published app root.
