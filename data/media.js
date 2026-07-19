// Add a media item only after it is confirmed and approved for publication.
// Keep empty otherwise so the Media Centre shows an honest "nothing published
// yet" state instead of fabricated news.
// Shape: { slug, type: "News"|"Announcement"|"Event"|"Press Release", title, excerpt, date }
export const mediaItems = [];

export const mediaTypes = ["News", "Announcement", "Event", "Press Release"];
