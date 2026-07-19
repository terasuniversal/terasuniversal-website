"use client";

import { useMemo, useState } from "react";
import { courseCatalog, courseHref } from "../data/courseCatalog";
import { industries } from "../data/industries";
import { faqItems } from "../data/faq";
import { insights } from "../data/insights";
import { resources } from "../data/resources";

const staticEntries = [
  ["Training", "Industrial safety and competency programmes for safety-critical workforces.", "/training", "Pages"],
  ["Compare Training Programmes", "Compare target audience, delivery mode, assessment and completion side by side.", "/training/compare", "Pages"],
  ["Services", "Industrial safety, technical competency, consultancy and workforce development.", "/services", "Pages"],
  ["About TERAS UNIVERSAL", "Our values, approach and commitment to safer, more capable organisations.", "/about", "Pages"],
  ["Industries We Serve", "Industry-specific training and consultancy recommendations.", "/industries", "Pages"],
  ["Request a Proposal", "Share your organisation's training requirements with our team.", "/request-proposal", "Pages"],
  ["Resources Centre", "Company information, course materials and training resources.", "/resources", "Resources"],
  ["Media Centre", "News, announcements, events and press releases.", "/media", "Pages"],
  ["Careers", "Career and internship opportunities with TERAS UNIVERSAL.", "/careers", "Pages"],
  ["Verify Certificate", "Confirm the status and validity of a training certificate.", "/verify", "Pages"],
];

const courseEntries = courseCatalog.map((course) => [course.title, course.summary, courseHref(course), "Courses"]);
const industryEntries = industries.map((industry) => [`${industry.name} Solutions`, industry.summary, `/industries/${industry.slug}`, "Industries"]);
const faqEntries = faqItems.map(([, question, answer]) => [question, answer, "/faq", "FAQ"]);
const insightEntries = insights.map((item) => [item.title, item.excerpt, `/insights/${item.slug}`, "Insights"]);
const resourceEntries = resources.map((item) => [item.title, item.text, item.href, "Resources"]);

const entries = [...staticEntries, ...courseEntries, ...industryEntries, ...faqEntries, ...insightEntries, ...resourceEntries];
const categories = ["All", ...new Set(entries.map((entry) => entry[3]))];

export default function SiteSearch() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return entries.filter((entry) => (category === "All" || entry[3] === category) && (!normalized || entry.slice(0, 2).join(" ").toLowerCase().includes(normalized)));
  }, [category, query]);

  return (
    <section className="search-tool" aria-labelledby="search-heading">
      <div className="search-controls">
        <label className="sr-only" htmlFor="site-search-input">Search the website</label>
        <input id="site-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search courses, industries, resources or FAQ..." type="search" />
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter search category">
          {categories.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      <p className="search-count" aria-live="polite">{results.length} result{results.length === 1 ? "" : "s"}</p>
      <div className="search-results">
        {results.map(([title, description, href, type]) => <a className="search-result-card" href={href} key={`${type}-${href}-${title}`}><span>{type}</span><h3>{title}</h3><p>{description}</p><strong>Open result <span aria-hidden="true">&rarr;</span></strong></a>)}
        {!results.length && <p className="search-empty">No matching results. Try a broader search term.</p>}
      </div>
    </section>
  );
}
