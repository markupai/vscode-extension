import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");
const isProduction = process.argv.includes("--production");

/**
 * Emits the begin/end markers and error format that the background
 * problemMatcher in .vscode/tasks.json watches for, so VS Code knows
 * when the watch build is ready and can launch the extension host.
 * @type {import('esbuild').Plugin}
 */
const problemMatcherPlugin = {
  name: "problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      }
      console.log("[watch] build finished");
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const sharedOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  external: ["vscode"],
  sourcemap: !isProduction,
  minify: isProduction,
  target: "ES2022",
  plugins: isWatch ? [problemMatcherPlugin] : [],
};

/** @type {import('esbuild').BuildOptions} */
const nodeOptions = {
  ...sharedOptions,
  platform: "node",
  format: "cjs",
  outfile: "out/extension.js",
};

/** @type {import('esbuild').BuildOptions} */
const webOptions = {
  ...sharedOptions,
  platform: "browser",
  format: "cjs",
  outfile: "out/web/extension.js",
};

async function build() {
  if (isWatch) {
    const [nodeCtx, webCtx] = await Promise.all([
      esbuild.context(nodeOptions),
      esbuild.context(webOptions),
    ]);
    await Promise.all([nodeCtx.watch(), webCtx.watch()]);
    console.log("Watching for changes...");
  } else {
    await Promise.all([esbuild.build(nodeOptions), esbuild.build(webOptions)]);
    console.log("Build complete.");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
