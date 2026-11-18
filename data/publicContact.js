// Public contact details shown on the website. Kept in this small module (not only in companyProfile.js) so client
// components such as MobileNav can import them without bundling the whole company profile into every page.
// Owner-confirmed display address. Form delivery is separate: app/api/contact and app/api/request-proposal keep their
// own recipient, which this value does not change.
export const publicContact = {
  email: "admin@terasuniversal.com.my",
  phone: "+60 19-519 3834",
};
