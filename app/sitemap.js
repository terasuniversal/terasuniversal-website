import { courseCatalog } from "../data/courseCatalog";

const siteUrl = "https://terasuniversal.com.my";
const staticRoutes = [
  ["", "monthly", 1], ["/about", "monthly", 0.8], ["/services", "monthly", 0.9], ["/services/scaffolding", "monthly", 0.8],
  ["/training", "weekly", 0.9], ["/training/scaffolding-competency", "monthly", 0.8], ["/calendar", "weekly", 0.8],
  ["/industries", "monthly", 0.8], ["/contact", "monthly", 0.8], ["/request-proposal", "monthly", 0.8], ["/resources", "weekly", 0.7],
  ["/insights", "weekly", 0.7], ["/stories", "monthly", 0.6], ["/gallery", "monthly", 0.6], ["/faq", "monthly", 0.7], ["/search", "monthly", 0.4], ["/verify", "monthly", 0.7],
];

export default function sitemap() {
  return [
    ...staticRoutes.map(([path, changeFrequency, priority]) => ({ url: `${siteUrl}${path}`, changeFrequency, priority })),
    ...courseCatalog.map((course) => ({ url: `${siteUrl}/training/${course.slug}`, changeFrequency: "monthly", priority: 0.8 })),
  ];
}
