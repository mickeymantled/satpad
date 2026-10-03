"use client";
// Client-side providers. The wallet provider arrives in M5 task 4; this shell keeps the layout a server component.
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
