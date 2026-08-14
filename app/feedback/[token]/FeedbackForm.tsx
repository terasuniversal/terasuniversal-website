"use client";

import { useState } from "react";
import { getSupabaseClient } from "../../../lib/supabase";
import { feedbackSubmissionSchema, FEEDBACK_PROBLEM_CATEGORIES } from "../../../lib/validation/schemas";

const RATING_QUESTIONS: { key: string; label: string }[] = [
  { key: "q1", label: "Course content was clear and relevant." },
  { key: "q2", label: "Training materials were useful." },
  { key: "q3", label: "Practical training was effective." },
  { key: "q4", label: "Trainer demonstrated good subject knowledge." },
  { key: "q5", label: "Trainer explained the topics clearly." },
  { key: "q6", label: "Registration process was smooth." },
  { key: "q7", label: "Training venue was comfortable." },
  { key: "q8", label: "Training equipment was satisfactory." },
  { key: "q9", label: "Food / refreshments were satisfactory." },
  { key: "q10", label: "Overall satisfaction." },
];

const CATEGORY_LABELS: Record<string, string> = {
  registration: "Registration",
  trainer: "Trainer",
  training_material: "Training Material",
  practical_equipment: "Practical Equipment",
  venue: "Venue",
  food_refreshment: "Food / Refreshment",
  schedule: "Schedule",
  assessment_examination: "Assessment / Examination",
  certificate: "Certificate",
  staff_service: "Staff Service",
  others: "Others",
};

const NPS_LABEL = ["Not at all likely", "", "", "", "", "", "", "", "", "", "Extremely likely"];

type FormValues = {
  q1: number; q2: number; q3: number; q4: number; q5: number;
  q6: number; q7: number; q8: number; q9: number; q10: number;
  nps: number | null;
  liked_most: string; improve: string;
  had_problem: boolean;
  problem_category: string; problem_description: string;
};

const emptyValues = (): FormValues => ({
  q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0, q8: 0, q9: 0, q10: 0,
  nps: null, liked_most: "", improve: "", had_problem: false, problem_category: "", problem_description: "",
});

export function FeedbackForm({ token }: { token: string }) {
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [done, setDone] = useState(false);

  const set = (patch: Partial<FormValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) delete next[k];
      return next;
    });
  };

  const ratingName = (q: number) => RATING_QUESTIONS[q - 1].label;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (status === "sending") return;

    const parsed = feedbackSubmissionSchema.safeParse({
      token,
      q1: values.q1, q2: values.q2, q3: values.q3, q4: values.q4, q5: values.q5,
      q6: values.q6, q7: values.q7, q8: values.q8, q9: values.q9, q10: values.q10,
      nps: values.nps ?? undefined,
      liked_most: values.liked_most,
      improve: values.improve,
      had_problem: values.had_problem,
      problem_category: values.had_problem ? values.problem_category || null : null,
      problem_description: values.problem_description,
    });

    if (!parsed.success) {
      const map: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_form";
        if (!map[key]) map[key] = issue.message;
      }
      setErrors(map);
      return;
    }

    setStatus("sending");
    setErrorMessage("");
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc("feedback_submit", {
        p_token: token,
        p_data: {
          q1: values.q1, q2: values.q2, q3: values.q3, q4: values.q4, q5: values.q5,
          q6: values.q6, q7: values.q7, q8: values.q8, q9: values.q9, q10: values.q10,
          nps: values.nps,
          liked_most: values.liked_most,
          improve: values.improve,
          had_problem: values.had_problem,
          problem_category: values.had_problem ? values.problem_category || null : null,
          problem_description: values.had_problem ? values.problem_description : "",
        },
      });

      if (error) throw new Error("We could not submit your feedback. Please try again.");

      const result = data?.[0] as { ok?: boolean; code?: string; message?: string } | undefined;
      if (!result?.ok) {
        if (result?.code === "duplicate") {
          setDone(true); // already submitted → treat as completed
        } else {
          setErrorMessage(result?.message ?? "We could not submit your feedback. Please try again.");
          setStatus("error");
        }
        return;
      }
      setDone(true);
    } catch (submitError) {
      setErrorMessage(submitError instanceof Error ? submitError.message : "We could not submit your feedback. Please try again.");
      setStatus("error");
    }
  }

  if (done) {
    return (
      <div className="feedback-state feedback-success" role="status">
        <div className="feedback-success-mark" aria-hidden="true">✓</div>
        <h2>Thank You</h2>
        <p>Your feedback has been successfully submitted.</p>
        <p>Your feedback helps TERAS improve the quality of our training and services.</p>
      </div>
    );
  }

  return (
    <form className="feedback-form" onSubmit={handleSubmit} noValidate>
      <fieldset className="feedback-block">
        <legend>How would you rate the following?</legend>
        {RATING_QUESTIONS.map((q, index) => (
          <div className="feedback-question" key={q.key}>
            <p className="feedback-question-text">
              <span className="feedback-qnum">{String(index + 1).padStart(2, "0")}</span>
              {q.label}
            </p>
            <div className="feedback-scale" role="group" aria-label={q.label}>
              {[1, 2, 3, 4, 5].map((score) => (
                <button
                  type="button"
                  key={score}
                  className={`feedback-scale-btn ${values[q.key as keyof Pick<FormValues, "q1"|"q2"|"q3"|"q4"|"q5"|"q6"|"q7"|"q8"|"q9"|"q10">] === score ? "is-selected" : ""}`}
                  aria-pressed={values[q.key as keyof Pick<FormValues, "q1"|"q2"|"q3"|"q4"|"q5"|"q6"|"q7"|"q8"|"q9"|"q10">] === score}
                  onClick={() => set({ [q.key]: score } as Partial<FormValues>)}
                >
                  {score}
                </button>
              ))}
              <span className="feedback-scale-labels" aria-hidden="true"><span>1 · Poor</span><span>5 · Excellent</span></span>
            </div>
            {errors[q.key] && <p className="feedback-error" role="alert">{errors[q.key]}</p>}
          </div>
        ))}
      </fieldset>

      <fieldset className="feedback-block">
        <legend>How likely are you to recommend TERAS UNIVERSAL to a colleague or partner?</legend>
        <div className="feedback-nps" role="group" aria-label="Recommendation score from 0 to 10">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => (
            <button
              type="button"
              key={score}
              className={`feedback-nps-btn ${values.nps === score ? "is-selected" : ""}`}
              aria-pressed={values.nps === score}
              aria-label={`${score} — ${score === 0 ? "not at all likely" : score === 10 ? "extremely likely" : ""}`}
              onClick={() => set({ nps: score })}
            >
              {score}
            </button>
          ))}
        </div>
        <div className="feedback-nps-labels" aria-hidden="true">
          <span>0 · Not at all likely</span>
          <span>10 · Extremely likely</span>
        </div>
        {errors.nps && <p className="feedback-error" role="alert">{errors.nps}</p>}
      </fieldset>

      <div className="feedback-block">
        <label className="feedback-label" htmlFor="liked_most">What did you like most?</label>
        <textarea id="liked_most" className="feedback-input" rows={3} value={values.liked_most} onChange={(e) => set({ liked_most: e.target.value })} placeholder="Optional" />
      </div>

      <div className="feedback-block">
        <label className="feedback-label" htmlFor="improve">What should we improve?</label>
        <textarea id="improve" className="feedback-input" rows={3} value={values.improve} onChange={(e) => set({ improve: e.target.value })} placeholder="Optional" />
      </div>

      <fieldset className="feedback-block">
        <legend>Did you experience any problem during your training?</legend>
        <div className="feedback-choice-row">
          <button type="button" className={`feedback-choice ${values.had_problem ? "is-selected" : ""}`} aria-pressed={values.had_problem} onClick={() => set({ had_problem: true })}>Yes</button>
          <button type="button" className={`feedback-choice ${!values.had_problem ? "is-selected" : ""}`} aria-pressed={!values.had_problem} onClick={() => set({ had_problem: false, problem_category: "", problem_description: "" })}>No</button>
        </div>
        {values.had_problem && (
          <div className="feedback-problem-fields">
            <label className="feedback-label" htmlFor="problem_category">Problem category</label>
            <select id="problem_category" className="feedback-input" value={values.problem_category} onChange={(e) => set({ problem_category: e.target.value })}>
              <option value="">Select a category</option>
              {FEEDBACK_PROBLEM_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
            {errors.problem_category && <p className="feedback-error" role="alert">{errors.problem_category}</p>}
            <label className="feedback-label" htmlFor="problem_description">Describe the problem</label>
            <textarea id="problem_description" className="feedback-input" rows={3} value={values.problem_description} onChange={(e) => set({ problem_description: e.target.value })} placeholder="Optional" />
          </div>
        )}
      </fieldset>

      {errorMessage && <p className="feedback-error" role="alert">{errorMessage}</p>}

      <button type="submit" className="feedback-submit" disabled={status === "sending"}>
        {status === "sending" ? "Submitting…" : "Submit Feedback"}
      </button>
      <p className="feedback-privacy">
        Your identity is never shown to trainers. Feedback is reviewed by TERAS UNIVERSAL to improve our training quality.
      </p>
    </form>
  );
}
