import { courseCatalog } from "../data/courseCatalog";
import { industries } from "../data/industries";

const siteUrl = "https://terasuniversal.com.my";
const staticRoutes = [
  ["", "monthly", 1], ["/about", "monthly", 0.8], ["/services", "monthly", 0.9], ["/services/scaffolding", "monthly", 0.8], ["/corporate-training", "monthly", 0.9],
  ["/training", "weekly", 0.9], ["/training/scaffolding-competency", "monthly", 0.8], ["/calendar", "weekly", 0.8],
  ["/industries", "monthly", 0.8], ["/contact", "monthly", 0.8], ["/request-proposal", "monthly", 0.8], ["/resources", "weekly", 0.7],
  ["/insights", "weekly", 0.7], ["/faq", "monthly", 0.7], ["/verify", "monthly", 0.7],
];

export default function sitemap() {
  return [
    ...staticRoutes.map(([path, changeFrequency, priority]) => ({ url: `${siteUrl}${path}`, changeFrequency, priority })),
    ...industries.map((industry) => ({ url: `${siteUrl}/industries/${industry.slug}`, changeFrequency: "monthly", priority: 0.8 })),
    ...courseCatalog.map((course) => ({ url: `${siteUrl}/training/${course.slug}`, changeFrequency: "monthly", priority: 0.8 })),
  ];
}
