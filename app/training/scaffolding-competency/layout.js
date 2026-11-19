import { scaffoldingContent } from "../../../content/en/scaffolding";
import { socialMetadata } from "../../../lib/social-metadata";

// Phase S4C-1: the route is now the Scaffolding Training category page (owner Option A); the metadata describes the
// category instead of the former single "programme". Canonical URL unchanged.
export const metadata = { title: { absolute: scaffoldingContent.meta.title }, description: scaffoldingContent.meta.description, alternates: { canonical: "/training/scaffolding-competency" }, ...socialMetadata({ title: scaffoldingContent.meta.title, description: scaffoldingContent.meta.description, path: "/training/scaffolding-competency" }) };
export default function ScaffoldingLayout({ children }) { return children; }
