import inner from "./inner.module.css";

// Only approved values are shown; anything the catalogue has not confirmed says so instead of guessing.
const lengthText = (course) => (/to be confirmed/i.test(course.duration || "") || !course.duration ? "Confirmed with scope" : course.duration);
const deliveryText = (course) => course.deliveryMode ?? "Confirmed with scope";

// One course (or the custom-solution entry when `course` is omitted) as an index row. The title link is stretched
// over the row, so the whole row is one target and there is a single link per row for keyboard and screen readers.
export default function ProgrammeRow({ course, href, headingLevel = 3, custom = false, cta, category, title, summary }) {
  const H = `h${headingLevel}`;
  const target = course ? `/training/${course.slug}` : href;
  return (
    <li className={`${inner.course} ${custom ? inner.custom : ""}`}>
      <div>
        <span className={inner.cat}>{course?.category ?? category}</span>
        <H><a className={inner.stretch} href={target}>{course?.title ?? title}</a></H>
      </div>
      <div>
        <p>{course?.summary ?? summary}</p>
        {course?.audience?.length > 0 && <p className={inner.suit}><b>Suitable for </b>{course.audience.slice(0, 3).join(", ")}</p>}
      </div>
      {course ? <dl className={inner.mini}><dt>Length</dt><dd>{lengthText(course)}</dd><dt>Delivery</dt><dd>{deliveryText(course)}</dd></dl> : <span />}
      <span className={inner.go} aria-hidden="true">{cta ?? "View course"} &rarr;</span>
    </li>
  );
}
