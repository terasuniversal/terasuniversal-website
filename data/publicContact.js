// Public contact details shown on the website. Kept in this small module (not only in companyProfile.js) so client
// components such as MobileNav can import them without bundling the whole company profile into every page.
// Owner-confirmed display address. Form delivery is separate: app/api/contact and app/api/request-proposal keep their
// own recipient, which this value does not change.
export const publicContact = {
  email: "admin@terasuniversal.com.my",
  phone: "+60 19-519 3834",
  // W2-A (owner-approved): the one public operating address, in the SSM company-profile spelling. The separate SSM
  // registered office address appears only in the Privacy Notice. app/layout.js keeps the JSON-LD street as a
  // literal (that root file is pinned by several contracts); scripts/public-address-contract.mts proves it matches.
  businessAddress: {
    lines: ["Lot 1961, Kampung Tanah Merah,", "Tanah Merah Dalam,", "06000 Jitra, Kedah, Malaysia"],
    oneLine: "Lot 1961, Kampung Tanah Merah, Tanah Merah Dalam, 06000 Jitra, Kedah, Malaysia",
    street: "Lot 1961, Kampung Tanah Merah, Tanah Merah Dalam",
    locality: "Jitra",
    region: "Kedah",
    postalCode: "06000",
    country: "MY",
  },
};
