import * as React from "react";

import { cn } from "@/lib/utils";

// Decorative only: the loading region that contains skeletons should carry
// aria-busy and a text status for assistive tech.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-border", className)}
      {...props}
    />
  );
}

export { Skeleton };
