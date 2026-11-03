import { Card, CardContent, CardHeader } from "../../../../components/ui/card";
import { Skeleton } from "../../../../components/ui/skeleton";

// Mirrors the dashboard's grid so the page does not shift when data lands.
function MetricSkeletons({ grid }: { grid: string }) {
  return (
    <div className={grid}>
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="gap-3 px-5 py-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-14" />
        </Card>
      ))}
    </div>
  );
}

export default function SalesDashboardLoading() {
  return (
    <div className="ta-sales" aria-busy="true">
      <p role="status" className="sr-only">Loading sales dashboard…</p>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-2">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-10 w-36" />
      </div>
      <div className="mb-6"><MetricSkeletons grid="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" /></div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-56" />
        </CardHeader>
        <CardContent className="grid gap-4">
          <MetricSkeletons grid="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
