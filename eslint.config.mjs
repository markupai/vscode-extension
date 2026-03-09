// @ts-check

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["eslint.config.mjs", "vitest.config.ts", "esbuild.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["esbuild.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    ignores: ["out", "dist", "coverage", ".vscode-test", ".vscode-test-web", "**/*.d.ts"],
  },
];
