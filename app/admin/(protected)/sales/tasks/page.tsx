import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { isAdmin } from "../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, Pagination, ListToolbar, ReadErrorState } from "../../../../../components/admin/ui";
import { dueDateState, mytEndOfTodayUtc, sanitizeSearchTerm, type SalesTaskRow } from "../../../../../lib/sales/crm";
import { clampPage, normalizePage, pageCountFor, pageRange, SALES_QUEUE_PAGE_SIZE } from "../../../../../lib/sales/pagination";
import { loadStaffOptions } from "./options";
import { formatMalaysiaDateTime } from "../../../../../lib/date-time";
import { normalizeTaskQueueContext, resolveTaskRelatedRecord, taskQueueFeedbackMessage, taskQueueHref, type TaskQueueContext, type TaskQueueView } from "../../../../../lib/sales/task-queue";
import { fetchSalesRowsInPages, isCurrentActiveTask, loadTaskArchiveState } from "../../../../../lib/sales/active-state";
import { TaskQueueActions } from "./TaskQueueActions";

export const metadata = { title: "Sales Tasks — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const VIEWS: readonly TaskQueueView[] = ["today", "overdue", "upcoming", "completed", "all"];
const VIEW_LABELS: Record<TaskQueueView, string> = { all: "All Open", overdue: "Overdue", today: "Due Today", upcoming: "Upcoming", completed: "Completed" };


type OpportunityLabel = { id: string; opportunity_no: string };
type QuotationLabel = { id: string; quotation_no: string; opportunity_id: string | null };

function RelatedRecordLink({ task, opportunitiesById, quotationsById }: {
  task: SalesTaskRow;
  opportunitiesById: Map<string, OpportunityLabel>;
  quotationsById: Map<string, QuotationLabel>;
}) {
  const related = resolveTaskRelatedRecord(task);
  if (!related) return <span>Not linked</span>;
  let label = "";
  if (related.kind === "opportunity") {
    const opportunity = opportunitiesById.get(related.id);
    label = `Opportunity ${opportunity?.opportunity_no ?? "record"}`;
  } else if (related.kind === "lead") {
    label = "Source Lead";
  } else {
    const quotation = quotationsById.get(related.id);
    label = `Quotation ${quotation?.quotation_no ?? "record"}`;
  }
  return <Link href={related.href}>{label} →</Link>;
}

function TaskTitle({ task }: { task: SalesTaskRow }) {
  return <div className="ta-task-title"><strong>{task.title}</strong>{task.description && <p className="ta-task-description" title={task.description}>{task.description}</p>}</div>;
}

function TaskDue({ task }: { task: SalesTaskRow }) {
  const state = task.status === "open" || task.status === "in_progress" ? dueDateState(task.due_at) : "none";
  return <>{task.due_at ? formatMalaysiaDateTime(task.due_at) : "No due date"}{state === "overdue" && <span className="ta-task-due-state overdue">Overdue</span>}{state === "today" && <span className="ta-task-due-state today">Today</span>}{state === "upcoming" && <span className="ta-task-due-state upcoming">Upcoming</span>}</>;
}

function TaskActions({ task, context, canManage }: { task: SalesTaskRow; context: TaskQueueContext; canManage: boolean }) {
  const query = new URLSearchParams({ view: context.view, owner: context.owner, ...(context.q ? { q: context.q } : {}), page: String(context.page) });
  return <div className="ta-task-next-actions">{canManage && <TaskQueueActions task={task} context={context} />}<Link href={`/admin/sales/tasks/${task.id}?${query.toString()}`} className="ta-btn ta-btn-outline ta-btn-sm">View task</Link></div>;
}

export default async function SalesTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; owner?: string; q?: string; page?: string; feedback?: string }>;
}) {
  const profile = await requireRole("editor");
  await requireModuleAccess("sales_tasks");
  const sp = await searchParams;
  const normalized = normalizeTaskQueueContext(sp);
  const view = normalized.view;
  const owner = normalized.owner;
  const requestedPage = normalizePage(sp.page);

  const supabase = await createSupabaseServerClient();
  const staff = await loadStaffOptions();
  const staffNames = new Map(staff.map((s) => [s.id, s.full_name]));

  const now = new Date();
  const endOfTodayMyt = mytEndOfTodayUtc(now).toISOString();
  const nowIso = now.toISOString();

  const createQuery = (mode: "count" | "rows") => {
    let query = supabase.from("sales_tasks");
    query = mode === "count" ? query.select("id", { count: "exact", head: true }) : query.select("*");
    query = query
      .is("deleted_at", null)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });

    if (view === "completed") {
      query = query.eq("status", "completed");
    } else {
      query = query.not("status", "in", "(completed,cancelled)");
      if (view === "overdue") query = query.not("due_at", "is", null).lt("due_at", nowIso);
      else if (view === "today") query = query.not("due_at", "is", null).gte("due_at", nowIso).lt("due_at", endOfTodayMyt);
      else if (view === "upcoming") query = query.not("due_at", "is", null).gte("due_at", endOfTodayMyt);
    }

    if (owner === "mine") query = query.eq("assigned_to", profile.id);
    else if (owner !== "all") query = query.eq("assigned_to", owner);

    if (normalized.q) {
      const term = sanitizeSearchTerm(normalized.q);
      if (term) query = query.ilike("title", `%${term}%`);
    }
    return query;
  };

  let count = 0;
  let countError: unknown = null;
  let rowsError: unknown = null;
  let page = 1;
  let pageCount = 1;
  let tasks: SalesTaskRow[] = [];
  if (view === "completed") {
    // Completed is a history surface; keep archived-chain records accessible here.
    const countResult = await createQuery("count");
    count = countResult.count ?? 0;
    countError = countResult.error;
    pageCount = pageCountFor(count);
    page = clampPage(requestedPage, pageCount);
    const range = pageRange(page, SALES_QUEUE_PAGE_SIZE);
    const rowsResult = await createQuery("rows").range(range.from, range.to);
    rowsError = rowsResult.error;
    tasks = (rowsResult.data ?? []) as SalesTaskRow[];
  } else {
    const countResult = await createQuery("count");
    countError = countResult.error;
    const candidateCount = countResult.count ?? 0;
    const { rows: candidateTasks, error: pageReadError } = await fetchSalesRowsInPages<SalesTaskRow>(
      candidateCount,
      (from, to) => createQuery("rows").range(from, to),
    );
    rowsError = pageReadError;
    const { state: taskArchiveState, error: taskArchiveError } = await loadTaskArchiveState(supabase, candidateTasks);
    rowsError = rowsError ?? taskArchiveError;
    const activeTasks = candidateTasks.filter((task) => isCurrentActiveTask(task, taskArchiveState));
    count = activeTasks.length;
    pageCount = pageCountFor(count);
    page = clampPage(requestedPage, pageCount);
    const range = pageRange(page, SALES_QUEUE_PAGE_SIZE);
    tasks = activeTasks.slice(range.from, range.to + 1);
  }

  const quotationIds = [...new Set(tasks.map((task) => task.quotation_id).filter((id): id is string => Boolean(id)))];
  const directOpportunityIds = [...new Set(tasks.map((task) => task.opportunity_id).filter((id): id is string => Boolean(id)))];

  const [quotationResult, opportunityResult] = await Promise.all([
    quotationIds.length
      ? supabase.from("sales_quotations").select("id, quotation_no, opportunity_id").in("id", quotationIds)
      : Promise.resolve({ data: [] as QuotationLabel[], error: null }),
    directOpportunityIds.length
      ? supabase.from("sales_opportunities").select("id, opportunity_no").in("id", directOpportunityIds)
      : Promise.resolve({ data: [] as OpportunityLabel[], error: null }),
  ]);

  const quotationRows = (quotationResult.data ?? []) as QuotationLabel[];
  const missingOpportunityIds = [...new Set(quotationRows
    .map((quotation) => quotation.opportunity_id)
    .filter((id): id is string => id !== null && !directOpportunityIds.includes(id)))];
  const extraOpportunityResult = missingOpportunityIds.length
    ? await supabase.from("sales_opportunities").select("id, opportunity_no").in("id", missingOpportunityIds)
    : { data: [] as OpportunityLabel[], error: null };

  const opportunityRows = [
    ...((opportunityResult.data ?? []) as OpportunityLabel[]),
    ...((extraOpportunityResult.data ?? []) as OpportunityLabel[]),
  ];
  const opportunitiesById = new Map(opportunityRows.map((opportunity) => [opportunity.id, opportunity]));
  const quotationsById = new Map(quotationRows.map((quotation) => [quotation.id, quotation]));
  const hasReadError = Boolean(countError || rowsError || quotationResult.error || opportunityResult.error || extraOpportunityResult.error);

  const queueContext: TaskQueueContext = { ...normalized, page };
  const qsBase: Record<string, string> = { view, owner };
  if (normalized.q) qsBase.q = normalized.q;
  const feedbackMessage = taskQueueFeedbackMessage(sp.feedback);

  return (
    <>
      <PageHead
        title="Sales Tasks"
        subtitle="Production to-dos linked to leads, opportunities and quotations — no demo records."
        action={<Link href="/admin/sales/tasks/new" className="ta-btn ta-btn-primary">+ New Task</Link>}
      />
      {feedbackMessage && (
        <div className={`ta-alert ${sp.feedback === "activity-warning" ? "ta-alert-error" : "ta-alert-success"}`} role={sp.feedback === "activity-warning" ? "alert" : "status"}>
          {feedbackMessage}
        </div>
      )}

      <ListToolbar style={{ flexWrap: "wrap" }}>
        {VIEWS.map((item) => (
          <Link
            key={item}
            href={taskQueueHref({ ...normalized, view: item, page: 1 })}
            className={`ta-btn ta-btn-sm ${view === item ? "ta-btn-primary" : "ta-btn-outline"}`}
            aria-current={view === item ? "page" : undefined}
          >
            {VIEW_LABELS[item]}
          </Link>
        ))}
        <div className="ta-spacer" />
        <select name="owner" defaultValue={owner} className="ta-filter-select" style={{ maxWidth: 180 }} aria-label="Owner filter">
          <option value="mine">My Tasks</option>
          <option value="all">All Tasks</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </select>
        <input type="hidden" name="view" value={view} />
        <div className="ta-search" style={{ maxWidth: 220 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={normalized.q ?? ""} placeholder="Example: renewal call…" aria-label="Search task titles" />
        </div>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
      </ListToolbar>

      <Card title={VIEW_LABELS[view]}>
        {hasReadError ? (
          <ReadErrorState message="Tasks or related record details could not be loaded. Refresh the page and try again." />
        ) : tasks.length > 0 ? (
          <>
            <div className="ta-table-wrap ta-tasks-table">
              <table className="ta-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Related Record</th>
                    <th>Owner</th>
                    <th>Priority</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th>Next Action</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => {
                    const canManage = isAdmin(profile.role) || t.assigned_to === profile.id || t.created_by === profile.id;
                    return (
                      <tr key={t.id}>
                        <td><TaskTitle task={t} /></td>
                        <td className="ta-task-related">
                          <RelatedRecordLink task={t} opportunitiesById={opportunitiesById} quotationsById={quotationsById} />
                        </td>
                        <td>{t.assigned_to ? staffNames.get(t.assigned_to) ?? "—" : "Unassigned"}</td>
                        <td><Badge status={t.priority} /></td>
                        <td className="ta-task-due"><TaskDue task={t} /></td>
                        <td><Badge status={t.status} /></td>
                        <td><TaskActions task={t} context={queueContext} canManage={canManage} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="ta-lead-cards ta-task-cards">
              {tasks.map((t) => {
                const canManage = isAdmin(profile.role) || t.assigned_to === profile.id || t.created_by === profile.id;
                return (
                  <li className="ta-card ta-lead-card ta-task-card" key={t.id}>
                    <div className="ta-lead-card-top">
                      <TaskTitle task={t} />
                      <Badge status={t.status} />
                    </div>
                    <div className="ta-task-card-related">
                      <span>Related Record</span>
                      <RelatedRecordLink task={t} opportunitiesById={opportunitiesById} quotationsById={quotationsById} />
                    </div>
                    <div className="ta-lead-card-grid">
                      <span>Owner</span>
                      <span>{t.assigned_to ? staffNames.get(t.assigned_to) ?? "—" : "Unassigned"}</span>
                      <span>Priority</span>
                      <span><Badge status={t.priority} /></span>
                      <span>Due</span>
                      <span className="ta-task-due"><TaskDue task={t} /></span>
                    </div>
                    <TaskActions task={t} context={queueContext} canManage={canManage} />
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <EmptyState icon="☑" kind={normalized.q || owner !== "all" || view !== "all" ? "no-results" : "empty"} title={normalized.q || owner !== "all" || view !== "all" ? "No matching tasks" : "No tasks yet"} message="No tasks are available for these filters." />
        )}
      </Card>
      <Pagination page={page} pageCount={pageCount} basePath="/admin/sales/tasks" query={qsBase} />
    </>
  );
}
