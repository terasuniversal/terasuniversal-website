"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../../../components/ui/card";

// Catches whole-page failures; individual metric query errors are already
// shown inline as "Unavailable" by the page itself.
export default function SalesDashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Sales dashboard route error", { digest: error.digest }); }, [error]);

  return (
    <Card role="alert" className="mx-auto my-8 max-w-xl">
      <CardHeader>
        <CardTitle className="text-lg"><h1>The sales dashboard could not be loaded</h1></CardTitle>
        <CardDescription>Try again, or open a sales queue directly to continue working.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        If this keeps happening, contact a system administrator and mention the time of the error.
      </CardContent>
      <CardFooter className="flex-wrap">
        <Button type="button" onClick={reset}>Try again</Button>
        <Button asChild variant="outline"><Link href="/admin/sales/leads">Go to leads</Link></Button>
      </CardFooter>
    </Card>
  );
}
