// Inline, blocking script string injected into <head> in __root.tsx so the
// correct theme class is on <html> before first paint (no flash of the
// wrong theme). Must stay logically in sync with resolve() in use-theme.tsx.
// Kept in its own module (rather than exported from use-theme.tsx) so that
// file only exports components/hooks and Fast Refresh keeps working there.
import { STORAGE_KEY } from "./use-theme";

export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var dark = stored === 'light'
      ? false
      : stored === 'dark'
        ? true
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;
