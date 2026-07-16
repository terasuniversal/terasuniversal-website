export default function sitemap() {
  return [
    { url: "https://terasuniversal.com.my", lastModified: new Date(), changeFrequency: "monthly", priority: 1 },
    { url: "https://terasuniversal.com.my/about", lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: "https://terasuniversal.com.my/services", lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
    { url: "https://terasuniversal.com.my/training", lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },
    { url: "https://terasuniversal.com.my/contact", lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: "https://terasuniversal.com.my/gallery", lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
  ];
}