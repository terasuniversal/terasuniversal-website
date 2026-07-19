import { courseCatalog } from "../data/courseCatalog";
import { industries } from "../data/industries";

const staticRoutes = [
  { url: "https://terasuniversal.com.my", changeFrequency: "monthly", priority: 1 },
  { url: "https://terasuniversal.com.my/about", changeFrequency: "monthly", priority: 0.8 },
  { url: "https://terasuniversal.com.my/services", changeFrequency: "monthly", priority: 0.9 },
  { url: "https://terasuniversal.com.my/training", changeFrequency: "monthly", priority: 0.9 },
  { url: "https://terasuniversal.com.my/training/compare", changeFrequency: "monthly", priority: 0.7 },
  { url: "https://terasuniversal.com.my/industries", changeFrequency: "monthly", priority: 0.8 },
  { url: "https://terasuniversal.com.my/contact", changeFrequency: "monthly", priority: 0.8 },
  { url: "https://terasuniversal.com.my/request-proposal", changeFrequency: "monthly", priority: 0.8 },
  { url: "https://terasuniversal.com.my/gallery", changeFrequency: "monthly", priority: 0.7 },
  { url: "https://terasuniversal.com.my/verify", changeFrequency: "monthly", priority: 0.7 },
  { url: "https://terasuniversal.com.my/calendar", changeFrequency: "weekly", priority: 0.7 },
  { url: "https://terasuniversal.com.my/insights", changeFrequency: "weekly", priority: 0.7 },
  { url: "https://terasuniversal.com.my/media", changeFrequency: "weekly", priority: 0.6 },
  { url: "https://terasuniversal.com.my/careers", changeFrequency: "weekly", priority: 0.6 },
  { url: "https://terasuniversal.com.my/resources", changeFrequency: "monthly", priority: 0.6 },
  { url: "https://terasuniversal.com.my/stories", changeFrequency: "monthly", priority: 0.6 },
  { url: "https://terasuniversal.com.my/faq", changeFrequency: "monthly", priority: 0.7 },
  { url: "https://terasuniversal.com.my/search", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap() {
  const now = new Date();
  const courseRoutes = courseCatalog
    .filter((course) => !course.detailPage)
    .map((course) => ({ url: `https://terasuniversal.com.my/training/${course.slug}`, lastModified: now, changeFrequency: "monthly", priority: 0.8 }));
  const scaffoldingRoute = { url: "https://terasuniversal.com.my/training/scaffolding-competency", lastModified: now, changeFrequency: "monthly", priority: 0.8 };
  const industryRoutes = industries.map((industry) => ({ url: `https://terasuniversal.com.my/industries/${industry.slug}`, lastModified: now, changeFrequency: "monthly", priority: 0.75 }));

  return [
    ...staticRoutes.map((route) => ({ ...route, lastModified: now })),
    scaffoldingRoute,
    ...courseRoutes,
    ...industryRoutes,
  ];
}
