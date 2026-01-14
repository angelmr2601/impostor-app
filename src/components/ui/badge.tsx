
import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "secondary" | "destructive" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        variant === "default" && "bg-black text-white",
        variant === "secondary" && "bg-black/10 text-black",
        variant === "destructive" && "bg-red-600 text-white",
        className
      )}
      {...props}
    />
  );
}
