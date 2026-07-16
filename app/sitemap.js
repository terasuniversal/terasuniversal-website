export default function sitemap() {
  return [{
    url: "https://terasuniversal.com.my",
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 1,
  }, {
    url: "https://terasuniversal.com.my/gallery",
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.7,
  }];
}
