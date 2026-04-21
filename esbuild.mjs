import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

/**
 * Load a .env file from the repo root if present. Only MARKUPAI_*
 * keys are used; everything else is ignored. Missing file → empty env.
 */
function loadDotenv() {
  const out = {};
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return out;
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key.startsWith("MARKUPAI_")) out[key] = value;
  }
  return out;
}

const fileEnv = loadDotenv();
const envName = (process.env.MARKUPAI_ENV ?? fileEnv.MARKUPAI_ENV ?? "prod").toLowerCase();
const buildEnv = envName === "dev" ? "dev" : "prod";
console.log(`esbuild: build-time environment = ${buildEnv}`);

const defineBase = {
  "process.env.MARKUPAI_BUILD_ENV": JSON.stringify(buildEnv),
  "process.env.NODE_ENV": production ? '"production"' : '"development"',
};

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
  define: defineBase,
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
    ...defineBase,
    global: "globalThis",
  },
};

try {
  if (watch) {
    const desktopCtx = await esbuild.context(desktop);
    const webCtx = await esbuild.context(web);
    await Promise.all([desktopCtx.watch(), webCtx.watch()]);
    console.log("esbuild: watching both targets (desktop + web)");
  } else {
    await Promise.all([esbuild.build(desktop), esbuild.build(web)]);
    console.log("esbuild: built desktop + web bundles");
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
