"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

// shadcn/ui Sheet on Radix Dialog: focus trap, Escape to close, focus return
// to the trigger, background scroll lock and aria-hidden on everything else.
// Rendered in place rather than portalled to <body>, so the content stays
// inside .teras-admin and keeps the --ta-* tokens. Place it outside any
// ancestor with transform/filter (fixed positioning would anchor to it).
// Slide and fade animations live in admin-tailwind.css.

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

/** Left-hand sheet with its overlay; the only side the admin uses. */
function SheetContent({ className, children, ...props }: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <>
      <SheetPrimitive.Overlay data-slot="sheet-overlay" className="fixed inset-0 z-50 bg-[rgba(9,32,63,0.55)]" />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn("fixed inset-y-0 left-0 z-50 flex h-full w-3/4 max-w-xs flex-col bg-background shadow-lg outline-none", className)}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </>
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn("font-heading font-semibold text-foreground", className)} {...props} />;
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description data-slot="sheet-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetTitle, SheetDescription };
