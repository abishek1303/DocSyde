"use client";

import { useEffect } from "react";

const UPWARD_SCROLL_SCALE = 0.6;

export function ScrollPace() {
  useEffect(() => {
    function handleWheel(event: WheelEvent) {
      if (event.defaultPrevented || !event.cancelable || event.deltaY >= 0 || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || window.scrollY <= 0) return;
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;

      // Leave independent scroll regions (including code blocks and dialogs) native.
      for (let element: Element | null = event.target; element && element !== document.body && element !== document.documentElement; element = element.parentElement) {
        const overflow = getComputedStyle(element).overflowY;
        if (/(auto|scroll|overlay)/.test(overflow) && element.scrollHeight > element.clientHeight) return;
      }
      const lineHeight = Number.parseFloat(getComputedStyle(document.documentElement).lineHeight) || 16;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? lineHeight : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1;
      event.preventDefault();
      // Explicitly bypass CSS smooth scrolling so wheel events do not queue animations.
      window.scrollBy({ top: event.deltaY * unit * UPWARD_SCROLL_SCALE, behavior: "instant" });
    }
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, []);
  return null;
}
