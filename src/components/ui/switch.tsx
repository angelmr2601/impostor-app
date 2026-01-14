import * as React from "react";
import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onCheckedChange
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "h-7 w-12 rounded-full border border-black/20 p-1 transition-colors",
        checked ? "bg-black" : "bg-black/10"
      )}
      onClick={() => onCheckedChange(!checked)}
      aria-pressed={checked}
    >
      <div className={cn("h-5 w-5 rounded-full bg-white transition-transform", checked ? "translate-x-5" : "translate-x-0")} />
    </button>
  );
}
