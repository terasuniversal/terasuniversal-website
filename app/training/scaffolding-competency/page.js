import Image from "next/image";
import PremiumHeader from "../../../components/premium/PremiumHeader";
import { publicBody } from "../../../components/premium/fonts";
import kit from "../../../components/premium/premium.module.css";
import training from "../../../components/training/training.module.css";
import styles from "../../../components/training/scaffolding.module.css";
import TrainingCourseCard from "../../../components/training/TrainingCourseCard";
import EbookPromo from "../../../components/ebook/EbookPromo";
import PremiumFooter from "../../../components/premium/PremiumFooter";
import { scaffoldingContent } from "../../../content/en/scaffolding";
import { courseCatalog } from "../../../data/courseCatalog";
import { SCAFFOLDING_CATEGORY, coursesInCategory, scaffoldingPathways } from "../../../lib/training-categories";

// Scaffolding Training category page (Phase S4C-1, owner Option A). The route is unchanged; it now lists the courses the
// catalogue classifies as "Scaffolding Competency" (scripts/scaffolding-category-contract.mts proves there are exactly
// six) in two pathways taken from the catalogue's own titles, each card linking to its existing course page. The former
// single-"programme" content (objectives, modules, FAQ, methodology) was not in the verified catalogue and was removed;
// the S4C-1 report lists each removal. Sessions and registration stay on the course pages and the calendar, governed by
// the shared session policy; nothing here offers registration directly.
export default function ScaffoldingCategoryPage() {
  const text = scaffoldingContent;
  const courses = coursesInCategory(courseCatalog, SCAFFOLDING_CATEGORY);
  const pathways = scaffoldingPathways(courses);
  const groups = [["scaffolding", pathways.scaffolding], ["inspection", pathways.inspection]].filter(([, list]) => list.length > 0);
  return (
    <>
      <PremiumHeader />
      <main className={publicBody.variable}>
        <section className={`${kit.px} ${kit.navyField} ${training.hero}`} aria-labelledby="scaffolding-title">
          <div className={`${kit.wrap} ${training.heroGrid}`}>
            <div>
              <nav className={styles.crumbs} aria-label={text.breadcrumb.label}>
                <a href="/">{text.breadcrumb.home}</a><span aria-hidden="true">/</span>
                <a href="/training">{text.breadcrumb.training}</a><span aria-hidden="true">/</span>
                <span aria-current="page">{text.hero.title}</span>
              </nav>
              <p className={training.heroEyebrow}>{SCAFFOLDING_CATEGORY}</p>
              <h1 id="scaffolding-title" className={training.title}>{text.hero.title}</h1>
              <p className={training.lead}>{text.hero.lead}</p>
              <div className={training.acts}>
                <a className={kit.btn} href={text.hero.toCourses.href}>{text.hero.toCourses.label}</a>
                <a className={`${kit.btn} ${kit.btnLight}`} href={text.hero.toCatalogue.href}>{text.hero.toCatalogue.label}</a>
              </div>
            </div>
            <figure className={styles.figure}>
              <Image src="/images/v2/panel-b.svg" alt="" unoptimized width={1200} height={800} priority sizes="(max-width: 960px) 100vw, 40vw" />
            </figure>
          </div>
        </section>

        <section id="scaffolding-courses" className={`${kit.px} ${kit.sec} ${kit.tone} ${training.catalogue}`} aria-labelledby="scaffolding-courses-title">
          <div className={kit.wrap}>
            <p className={training.eyebrow}>{text.courses.eyebrow}</p>
            <h2 id="scaffolding-courses-title">{text.courses.title}</h2>
            <p className={training.count}><strong>{text.courses.count(courses.length)}</strong></p>
            {groups.map(([key, list]) => (
              <div className={styles.pathway} key={key}>
                <h3 id={`pathway-${key}`}>{text.courses.pathways[key].title}</h3>
                <p className={styles.pathwayText}>{text.courses.pathways[key].text}</p>
                <ul className={training.cards} aria-labelledby={`pathway-${key}`}>
                  {list.map((course) => <TrainingCourseCard key={course.slug} course={course} />)}
                </ul>
              </div>
            ))}
            <p className={styles.note}>{text.courses.note}</p>
          </div>
        </section>

        <section className={`${kit.px} ${kit.sec} ${styles.guidance}`} aria-labelledby="scaffolding-guidance-title">
          <div className={kit.wrap}>
            <p className={training.eyebrow}>{text.guidance.eyebrow}</p>
            <h2 id="scaffolding-guidance-title">{text.guidance.title}</h2>
            <ul className={styles.guidanceList}>{text.guidance.items.map((item) => <li key={item}>{item}</li>)}</ul>
            <a className={kit.tl} href={text.guidance.calendar.href}>{text.guidance.calendar.label}</a>
            <EbookPromo />
          </div>
        </section>

        <section className={`${kit.px} ${kit.sec} ${kit.navyField}`} aria-labelledby="scaffolding-corporate-title">
          <div className={`${kit.wrap} ${training.corporate}`}>
            <div>
              <p className={training.heroEyebrow}>{text.corporate.eyebrow}</p>
              <h2 id="scaffolding-corporate-title">{text.corporate.title}</h2>
              <p className={training.corporateText}>{text.corporate.text}</p>
            </div>
            <div className={training.acts}>
              <a className={kit.btn} href={text.corporate.primary.href}>{text.corporate.primary.label}</a>
              <a className={`${kit.btn} ${kit.btnLight}`} href={text.corporate.whatsapp.href} target="_blank" rel="noreferrer">{text.corporate.whatsapp.label}</a>
              <a className={kit.tl} href={text.corporate.corporate.href}>{text.corporate.corporate.label}</a>
            </div>
          </div>
        </section>
      </main>
        <PremiumFooter />
    </>
  );
}
