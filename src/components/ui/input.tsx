import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-2xl border border-black/15 px-3 text-sm outline-none focus:border-black/30",
        className
      )}
      {...props}
    />
  );
}
