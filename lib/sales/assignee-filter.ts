export interface AssigneeOption {
  value: string;
  label: string;
}

export interface AssigneeFilterState {
  disabled: boolean;
  value: string;
  options: AssigneeOption[];
  notice: string | null;
}

const STAFF_OPTIONS_UNAVAILABLE = "__staff_options_unavailable__";

export function buildAssigneeFilterState(
  staffLookupFailed: boolean,
  selectedAssignee: string | undefined,
  staff: { id: string; full_name: string }[],
): AssigneeFilterState {
  const selectedStaffUnavailable = Boolean(staffLookupFailed && selectedAssignee && selectedAssignee !== "unassigned");
  const disabled = staffLookupFailed && !selectedAssignee;
  const value = disabled ? STAFF_OPTIONS_UNAVAILABLE : selectedAssignee ?? "";
  const options: AssigneeOption[] = [
    { value: "", label: "Anyone" },
    { value: "unassigned", label: "Unassigned" },
  ];

  if (selectedStaffUnavailable && selectedAssignee) {
    options.push({ value: selectedAssignee, label: "Selected assignee unavailable" });
  } else if (!staffLookupFailed) {
    options.push(...staff.map(({ id, full_name }) => ({ value: id, label: full_name })));
  }

  if (disabled) options.unshift({ value: STAFF_OPTIONS_UNAVAILABLE, label: "Staff options unavailable" });

  return {
    disabled,
    value,
    options,
    notice: staffLookupFailed ? "Staff options unavailable" : null,
  };
}
