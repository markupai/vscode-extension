import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");
const isProduction = process.argv.includes("--production");

/** @type {import('esbuild').BuildOptions} */
const sharedOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  external: ["vscode"],
  sourcemap: !isProduction,
  minify: isProduction,
  target: "ES2022",
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
