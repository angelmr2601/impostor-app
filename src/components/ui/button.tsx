import * as React from "react";
import { cn } from "@/lib/utils";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline";
  size?: "default" | "sm";
};

export function Button({ className, variant = "default", size = "default", ...props }: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-2xl text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" ? "h-9 px-3" : "h-10 px-4",
        variant === "default"
          ? "bg-black text-white hover:opacity-90"
          : "border border-black/20 hover:bg-black/5",
        className
      )}
      {...props}
    />
  );
}
