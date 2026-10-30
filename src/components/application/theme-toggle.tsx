"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  function toggleTheme() {
    const dark = document.documentElement.classList.toggle("dark");
    try {
      localStorage.setItem("docsyde-theme", dark ? "dark" : "light");
    } catch {
      // The toggle still works when the browser blocks persistent storage.
    }
  }

  return (
    <Button variant="outline" onClick={toggleTheme} aria-label="Toggle light and dark mode">
      <Moon aria-hidden="true" className="dark:hidden" />
      <Sun aria-hidden="true" className="hidden dark:block" />
      <span className="dark:hidden">Dark mode</span>
      <span className="hidden dark:inline">Light mode</span>
    </Button>
  );
}
