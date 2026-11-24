import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// shadcn/ui-style primitive, hand-written (the shadcn CLI registry isn't reachable from this build env).
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 select-none [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        gold: "bg-gold-500 text-ink-950 hover:bg-gold-400 active:bg-gold-600",
        dark: "bg-ink-900 text-cream-50 hover:bg-ink-800 active:bg-ink-950",
        outline: "border-2 border-ink-900/15 bg-white text-ink-900 hover:border-ink-900/40",
        ghost: "text-ink-700 hover:bg-ink-900/5",
        danger: "bg-red-700 text-white hover:bg-red-800",
        success: "bg-emerald-700 text-white hover:bg-emerald-800",
      },
      size: {
        sm: "h-10 px-3 text-sm",
        md: "h-12 px-4 text-base",
        lg: "h-14 px-6 text-lg",
        icon: "h-12 w-12",
      },
    },
    defaultVariants: { variant: "dark", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
