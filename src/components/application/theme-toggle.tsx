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
    <Button type="button" variant="ghost" size="icon-lg" onClick={toggleTheme} aria-label="Toggle light and dark mode" title="Toggle light and dark mode" className="text-muted-foreground hover:text-foreground">
      <Moon aria-hidden="true" className="size-5 dark:hidden" />
      <Sun aria-hidden="true" className="hidden size-5 dark:block" />
    </Button>
  );
}
