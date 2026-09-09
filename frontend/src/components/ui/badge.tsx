import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground",
        admin: "border-transparent bg-red-600 text-white shadow hover:bg-red-700",
        hotel_manager: "border-transparent bg-blue-600 text-white shadow hover:bg-blue-700",
        grocery_manager: "border-transparent bg-emerald-600 text-white shadow hover:bg-emerald-700",
        delivery_boy: "border-transparent bg-amber-500 text-white shadow hover:bg-amber-600",
        rider: "border-transparent bg-violet-600 text-white shadow hover:bg-violet-700",
        all_in_one_partner: "border-transparent bg-cyan-600 text-white shadow hover:bg-cyan-700",
        customer: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
