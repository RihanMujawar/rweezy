import { useEffect } from "react";

function applySystemTheme() {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", prefersDark);
}

export function SystemThemeSync() {
  useEffect(() => {
    localStorage.removeItem("rweezy-theme");
    applySystemTheme();

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applySystemTheme();
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  return null;
}
