import Link from "next/link";
import { Badge, Card, EmptyState, PageHead, StatCard } from "../../../../components/admin/ui";
import type { ScheduleOperationsRow, TrainingOperationsDashboardData } from "../../../../lib/dashboard/trainingOperations";

function dateLabel(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1]} ${year}`;
}

function dateRange(row: ScheduleOperationsRow): string {
  return row.startDate === row.endDate ? dateLabel(row.startDate) : `${dateLabel(row.startDate)} – ${dateLabel(row.endDate)}`;
}

function attendanceLabel(row: ScheduleOperationsRow): string {
  if (!row.attendance) return "Attendance unavailable";
  if (row.attendance.state === "not_started") return "Not started";
  return `${row.attendance.recordedSessions} recorded session${row.attendance.recordedSessions === 1 ? "" : "s"} · ${row.attendance.fullyPresent}/${row.rosterCount} fully present`;
}

function assessmentLabel(row: ScheduleOperationsRow): string {
  if (!row.assessment) return "Assessment unavailable";
  if (!row.assessmentRequired) return "Assessment not required";
  if (row.assessment.notStarted === row.rosterCount && row.rosterCount > 0) return "Not started";
  return `${row.assessment.started}/${row.rosterCount} started · ${row.assessment.resultPending} pending`;
}

function scheduleCard(row: ScheduleOperationsRow, data: TrainingOperationsDashboardData) {
  const assignmentIssues = row.assignments
    ? Number(row.assignments.missingTrainer) + Number(row.assignments.missingPrimaryAssessor) + Number(row.assignments.inactivePrimaryAssessor) + row.assignments.missingGroupTrainer + row.assignments.missingEffectiveGroupAssessor + row.assignments.inactiveGroupAssessor + Number(row.assignments.ungroupedParticipants > 0)
    : 0;
  return (
    <article className="ta-ops-schedule-card" key={row.id}>
      <div className="ta-ops-card-topline"><Badge status={row.status} /><span className="ta-muted-sub">{row.scheduleCode}</span></div>
      <h3>{row.courseName}</h3>
      <p className="ta-ops-date">{dateRange(row)}{row.venue ? ` · ${row.venue}` : ""}</p>
      <div className="ta-ops-facts">
        <span><strong>{row.rosterCount}</strong> participants</span>
        <span><strong>{row.seatsTaken}/{row.capacity || "—"}</strong> seats</span>
        <span><strong>{row.trainerName || "—"}</strong> trainer</span>
      </div>
      <div className="ta-ops-progress-lines">
        {data.access.attendance && <div><span>Attendance</span><strong>{attendanceLabel(row)}</strong></div>}
        {data.access.assessment && <div><span>Assessment</span><strong>{assessmentLabel(row)}</strong></div>}
      </div>
      {assignmentIssues > 0 && <p className="ta-ops-card-warning">{assignmentIssues} assignment item{assignmentIssues === 1 ? "" : "s"} needs attention.</p>}
      <div className="ta-ops-actions">
        <Link className="ta-btn ta-btn-outline ta-btn-sm" href={`/admin/schedules/${row.id}`}>Open Schedule</Link>
        {data.access.attendance && <Link className="ta-btn ta-btn-outline ta-btn-sm" href={`/admin/attendance/${row.id}`}>Attendance</Link>}
        {data.access.assessment && <Link className="ta-btn ta-btn-primary ta-btn-sm" href={`/admin/assessment/${row.id}`}>Assessment</Link>}
      </div>
    </article>
  );
}

export function TrainingOperationsDashboard({ data }: { data: TrainingOperationsDashboardData }) {
  const progressRows = [...data.active, ...data.upcoming];
  const assignmentRows = progressRows.filter((row) => {
    const a = row.assignments;
    return a && (a.missingTrainer || a.missingPrimaryAssessor || a.inactivePrimaryAssessor || a.missingGroupTrainer > 0 || a.missingEffectiveGroupAssessor > 0 || a.inactiveGroupAssessor > 0 || a.ungroupedParticipants > 0);
  });
  return (
    <>
      <PageHead title="Training Operations" subtitle="Live training delivery, progress and operational exceptions." />
      <section className="ta-ops-summary" aria-label="Operational summary">
        <StatCard icon="▶" label="Active Now" value={data.summary.activeNow} href="#active-training" />
        <StatCard icon="🗓" label="Upcoming 7 Days" value={data.summary.upcoming7Days} href="#upcoming-training" />
        <StatCard icon="⚠" label="Needs Attention" value={data.summary.needsAttention} href="#needs-attention" />
        <StatCard icon="✓" label="Completed This Month" value={data.summary.completedThisMonth} href="#completed-summary" />
      </section>

      <form className="ta-ops-filters" aria-label="Training Operations filters" method="get">
        <label>Timeframe<select name="timeframe" defaultValue={data.filters.timeframe}><option value="today">Today</option><option value="this-week">This Week</option><option value="upcoming">Upcoming</option></select></label>
        <label>Course<select name="courseId" defaultValue={data.filters.courseId}><option value="">All courses</option>{data.filterOptions.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
        <label>Status<select name="status" defaultValue={data.filters.status}><option value="">Active and upcoming</option><option value="open">Open</option><option value="full">Full</option><option value="in_progress">In progress</option></select></label>
        {data.filterOptions.trainers.length > 0 && <label>Trainer<select name="trainer" defaultValue={data.filters.trainer}><option value="">All trainers</option>{data.filterOptions.trainers.map((trainer) => <option key={trainer} value={trainer}>{trainer}</option>)}</select></label>}
        {data.filterOptions.assessors.length > 0 && <label>Assessor<select name="assessor" defaultValue={data.filters.assessor}><option value="">All assessors</option>{data.filterOptions.assessors.map((assessor) => <option key={assessor} value={assessor}>{assessor}</option>)}</select></label>}
        <button className="ta-btn ta-btn-outline ta-btn-sm" type="submit">Apply</button>
      </form>

      <section id="needs-attention" className="ta-ops-section" aria-labelledby="needs-attention-title">
        <Card title="Needs Attention" action={<span className="ta-ops-section-note">{data.summary.needsAttention} operational item{data.summary.needsAttention === 1 ? "" : "s"}</span>}>
          {data.attention.length === 0 ? <EmptyState icon="✓" title="All clear" message={data.hasOperationalSchedules ? "No current operational exceptions match these filters." : "No active or upcoming training schedules."} /> : <div className="ta-ops-attention-list">{data.attention.slice(0, 24).map((item) => <div className="ta-ops-attention-item" key={item.key}><div><Badge status={item.severity} /><strong>{item.label}</strong><span>{item.courseName} · {item.scheduleCode}</span></div><Link className="ta-btn ta-btn-outline ta-btn-sm" href={item.href}>Open</Link></div>)}</div>}
        </Card>
      </section>

      <section id="active-training" className="ta-ops-section" aria-labelledby="active-training-title">
        <div className="ta-ops-section-heading"><h2 id="active-training-title">Active Training</h2><Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/schedules?status=in_progress">View schedules</Link></div>
        {data.active.length === 0 ? <EmptyState icon="▶" title="No active training" message="There are no in-progress schedules in the current operational view." /> : <div className="ta-ops-schedule-grid">{data.active.map((row) => scheduleCard(row, data))}</div>}
      </section>

      <section id="upcoming-training" className="ta-ops-section" aria-labelledby="upcoming-training-title">
        <div className="ta-ops-section-heading"><h2 id="upcoming-training-title">Upcoming Training</h2><Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/schedules">View schedules</Link></div>
        {data.upcoming.length === 0 ? <EmptyState icon="🗓" title="No upcoming training" message="No open or full schedules match the selected timeframe." /> : <div className="ta-ops-schedule-grid">{data.upcoming.map((row) => scheduleCard(row, data))}</div>}
      </section>

      <section className="ta-ops-section" aria-labelledby="progress-title">
        <div className="ta-ops-section-heading"><h2 id="progress-title">Attendance &amp; Assessment Progress</h2></div>
        {progressRows.length === 0 ? <EmptyState icon="◷" title="No progress to show" message="Active or upcoming schedules will appear here when available." /> : <div className="ta-ops-progress-grid">{progressRows.map((row) => <Card key={row.id} title={row.courseName} action={<Badge status={row.status} />}><div className="ta-ops-progress-detail"><span>{row.scheduleCode}</span>{data.access.attendance && <p><strong>Attendance</strong>{attendanceLabel(row)}</p>}{data.access.assessment && <p><strong>Assessment</strong>{assessmentLabel(row)}{row.assessment && row.assessmentRequired && <small>Pass {row.assessment.pass} · Fail {row.assessment.fail}{row.competencyRequired ? ` · Competency pending ${row.assessment.competencyPending}` : ""}</small>}</p>}</div></Card>)}</div>}
      </section>

      <section className="ta-ops-section" aria-labelledby="assignment-title">
        <div className="ta-ops-section-heading"><h2 id="assignment-title">Assignment Health</h2><Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/schedules">Manage schedules</Link></div>
        {assignmentRows.length === 0 ? <EmptyState icon="✓" title="Assignments look healthy" message="No trainer, assessor or group assignment gaps were found in the operational view." /> : <div className="ta-ops-assignment-list">{assignmentRows.map((row) => <div className="ta-ops-assignment-item" key={row.id}><div><strong>{row.courseName}</strong><span>{row.scheduleCode}</span></div><div className="ta-ops-assignment-tags">{row.assignments?.missingTrainer && <Badge status="trainer missing" />}{row.assignments?.missingPrimaryAssessor && <Badge status="assessor missing" />}{row.assignments?.inactivePrimaryAssessor && <Badge status="assessor inactive" />}{row.assignments && row.assignments.missingGroupTrainer > 0 && <Badge status="group trainer missing" />}{row.assignments && row.assignments.missingEffectiveGroupAssessor > 0 && <Badge status="group assessor missing" />}{row.assignments && row.assignments.inactiveGroupAssessor > 0 && <Badge status="group assessor inactive" />}{row.assignments && row.assignments.ungroupedParticipants > 0 && <Badge status="participants ungrouped" />}</div><Link className="ta-btn ta-btn-outline ta-btn-sm" href={`/admin/schedules/${row.id}`}>Open Schedule</Link></div>)}</div>}
      </section>

      <section id="completed-summary" className="ta-ops-section" aria-labelledby="quick-actions-title">
        <Card title="Quick Actions"><div className="ta-ops-quick-actions"><Link className="ta-btn ta-btn-primary" href="/admin/schedules">Open Schedules</Link>{data.access.attendance && <Link className="ta-btn ta-btn-outline" href="/admin/attendance">Attendance</Link>}{data.access.assessment && <Link className="ta-btn ta-btn-outline" href="/admin/assessment">Assessment</Link>}<Link className="ta-btn ta-btn-outline" href="/admin/participants">Participants</Link><Link className="ta-btn ta-btn-outline" href="/admin/schedules">Manage Groups &amp; Assignments</Link></div></Card>
      </section>
    </>
  );
}
