"use client";

import { Printer } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Names the document (browsers use the title as the PDF's file name) and offers a Print button.
 * With `auto`, opens the print dialog once fonts and images (the logo) have loaded.
 */
export function PrintControls({ title, auto }: { title: string; auto: boolean }) {
  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    if (!auto) return;
    let cancelled = false;
    const images = [...document.images].map((image) =>
      image.complete ? Promise.resolve() : new Promise<void>((resolve) => image.addEventListener("load", () => resolve(), { once: true })),
    );
    void Promise.all([document.fonts.ready, ...images]).then(() => {
      // One frame for layout to settle after the last font swap.
      requestAnimationFrame(() => {
        if (!cancelled) window.print();
      });
    });
    return () => {
      cancelled = true;
    };
  }, [auto]);

  return (
    <Button onClick={() => window.print()}>
      <Printer />
      Print or save as PDF
    </Button>
  );
}
