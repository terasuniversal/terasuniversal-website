// Fixed, data-free query values carried across a redirect when the primary write succeeded but
// a follow-up write did not. Only these exact values are recognised; anything else is ignored,
// so a URL can never inject text into the page.
export const ACTIVITY_UNSAVED_NOTICE = "activity-unsaved";
export const LINK_FAILED_NOTICE = "link-failed";

export const ACTIVITY_UNSAVED_MESSAGE =
  "The record was saved, but its entry in the activity timeline could not be recorded. Refresh to check before making further changes.";
export const OPPORTUNITY_LINK_FAILED_MESSAGE =
  "The company could not be linked to this opportunity. Nothing else changed — refresh and try linking again.";

export function withNotice(path: string, notice: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}notice=${notice}`;
}
