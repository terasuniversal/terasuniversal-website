// Any postcss.config replaces Next's built-in pipeline, so Next's default
// plugins (flexbugs fixes + preset-env/autoprefixer, with the same options
// as Next's getDefaultPlugins in its css/plugins build block) are restated here
// as pinned direct dependencies. Dropping them strips grid-gap and -webkit-
// fallbacks from the public CSS. The browser list is set here rather than
// in package.json, where it would also pin Next's JavaScript targets; it
// mirrors Next's default and the foundation contract test keeps it in step.
//
// Tailwind only acts on stylesheets that import it. Today that is
// app/admin/admin-tailwind.css alone; app/globals.css has no Tailwind
// directives and passes through unchanged.
const config = {
  plugins: [
    "@tailwindcss/postcss",
    "postcss-flexbugs-fixes",
    [
      "postcss-preset-env",
      {
        browsers: ["chrome 64", "edge 79", "firefox 67", "opera 51", "safari 12"],
        autoprefixer: { flexbox: "no-2009" },
        stage: 3,
        features: { "custom-properties": false },
      },
    ],
  ],
};

export default config;
