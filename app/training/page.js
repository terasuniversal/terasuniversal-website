"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import MobileNav from "../../components/MobileNav";
import MegaNav from "../../components/MegaNav";
import TrainingFinder from "../../components/TrainingFinder";
import TrainingComparison from "../../components/TrainingComparison";
import Footer from "../../components/Footer";
import CourseCard from "../../components/public/CourseCard";
import { courseCatalog, comparableCourses } from "../../data/courseCatalog";

const categories = ["All Programmes", ...new Set(courseCatalog.map((course) => course.category))];
const deliveryOptions = [["01", "Public Programme", "Scheduled learning for individuals and employees from different organisations."], ["02", "In-House Training", "A focused programme delivered exclusively for one organisation or workforce group."], ["03", "Onsite Training", "Practical learning arranged at a client workplace, plant, project site or approved facility."], ["04", "Competency Assessment", "Structured theoretical and practical evaluation against defined requirements."]];

export default function TrainingPage() {
  const [activeCategory, setActiveCategory] = useState("All Programmes");
  const visibleCourses = useMemo(() => activeCategory === "All Programmes" ? courseCatalog : courseCatalog.filter((course) => course.category === activeCategory), [activeCategory]);

  return <main className="training-page">
    <header className="site-header"><div className="container nav-wrap"><a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a><MegaNav /><MobileNav basePath="/" /></div></header>
    <section className="training-hero" aria-labelledby="training-hero-title"><div className="container training-hero-grid"><div className="training-hero-copy"><span className="eyebrow">Training Programmes</span><h1 id="training-hero-title">Practical Training for Safer and More Competent Workforces</h1><p>Explore TERAS public course pages, then review available sessions or discuss an arrangement for your workforce.</p><div className="hero-actions"><a className="btn btn-primary" href="#course-catalogue">View Training</a><a className="btn btn-outline" href="/request-proposal?source=training-hero">Request Corporate Training</a></div><div className="training-hero-features" aria-label="Training strengths"><span>Practical Delivery</span><span>Industry Focused</span><span>Competency Based</span><span>Custom Programmes</span></div></div><figure className="training-hero-media"><Image src="/images/temp-ai-industrial-safety-briefing.webp" alt="Industrial safety briefing in a training environment." width={1200} height={800} priority sizes="(max-width: 920px) 100vw, 52vw" /></figure></div></section>
    <TrainingFinder />
    <section id="course-catalogue" className="training-programmes-section" aria-labelledby="programme-title"><div className="container"><div className="section-heading training-section-heading"><span className="eyebrow">Course Catalogue</span><h2 id="programme-title">Find a verified public course page.</h2><p>Each course below has its own public detail page. Other workforce requirements can be discussed directly with TERAS.</p></div><div className="training-filters" role="group" aria-label="Filter training courses">{categories.map((category) => <button key={category} type="button" className={activeCategory === category ? "is-active" : ""} aria-pressed={activeCategory === category} onClick={() => setActiveCategory(category)}>{category}</button>)}</div><p className="training-programme-count" aria-live="polite"><strong>{visibleCourses.length}</strong> public course{visibleCourses.length === 1 ? "" : "s"} available</p><div className="training-programme-grid" aria-live="polite">{visibleCourses.map((course) => <CourseCard key={course.slug} course={course} />)}<CourseCard source="training-catalogue" /></div></div></section>
    <TrainingComparison courses={comparableCourses()} />
    <section className="training-delivery-section" aria-labelledby="delivery-title"><div className="container"><div className="section-heading"><span className="eyebrow">Delivery Options</span><h2 id="delivery-title">A flexible arrangement for every organisation.</h2><p>Public course details and calendar entries are published separately from custom, in-house and onsite arrangements.</p></div><div className="training-delivery-grid">{deliveryOptions.map(([number, title, text]) => <article key={title}><span>{number}</span><h3>{title}</h3><p>{text}</p></article>)}</div></div></section>
    <section className="training-corporate-cta"><div className="container"><div><span className="eyebrow">Corporate &amp; Custom Solutions</span><h2>Need a Programme Built Around Your Workforce?</h2><p>Discuss a customised training solution aligned with your operational requirements, participant profile and delivery arrangement.</p></div><div className="hero-actions"><a className="btn btn-gold" href="/request-proposal?source=training-corporate">Request Corporate Training</a><a className="btn btn-light" href="https://wa.me/60195193834?text=Hi%20TERAS%2C%20saya%20ingin%20bertanya%20tentang%20latihan%20korporat." target="_blank" rel="noreferrer">WhatsApp TERAS</a></div></div></section>
    <Footer />
  </main>;
}
