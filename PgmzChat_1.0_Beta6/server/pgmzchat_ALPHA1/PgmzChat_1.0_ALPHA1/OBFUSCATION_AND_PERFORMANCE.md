# Build and performance notes

- Android app code is built with R8/minification enabled for debug and release variants.
- SVG icons are embedded in the HTML, avoiding external icon font downloads.
- `build-termux.sh` replaces the Android WebView asset directory before every build so deleted or renamed web assets cannot remain stale in the APK.
- CSS respects `prefers-reduced-motion`; the in-app “Улучшенные анимации” switch disables the composer bubble-flight effect and icon animations.
- The local chat is responsive and intended for Android phones, with a scrollable side drawer and a settings page that scrolls independently.
- Server polling is only active when a server address has been configured. API responses are not cached by the service worker.
