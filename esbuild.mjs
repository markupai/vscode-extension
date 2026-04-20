import esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const shared = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: "info",
  external: ["vscode"],
};

const desktop = {
  ...shared,
  entryPoints: ["src/extension.ts"],
  outfile: "out/extension.js",
  platform: "node",
  format: "cjs",
  target: ["node20"],
  mainFields: ["module", "main"],
};

const web = {
  ...shared,
  entryPoints: ["src/extension.ts"],
  outfile: "out/web/extension.js",
  platform: "browser",
  format: "cjs",
  target: ["es2022"],
  mainFields: ["browser", "module", "main"],
  define: {
    "process.env.NODE_ENV": production ? '"production"' : '"development"',
    global: "globalThis",
  },
};

async function build() {
  if (watch) {
    const desktopCtx = await esbuild.context(desktop);
    const webCtx = await esbuild.context(web);
    await Promise.all([desktopCtx.watch(), webCtx.watch()]);
    console.log("esbuild: watching both targets (desktop + web)");
  } else {
    await Promise.all([esbuild.build(desktop), esbuild.build(web)]);
    console.log("esbuild: built desktop + web bundles");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
