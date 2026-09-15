import config from "@iobroker/eslint-config";

export default [
  ...config,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["*.mjs", "vitest.config.mts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    ignores: [
      ".dev-server/",
      ".vscode/",
      "*.test.js",
      "test/**",
      "*.config.mjs",
      "build",
      // Generated coverage report (npm run coverage) — never lint it.
      "coverage",
      // The note-taking hook's session files (git-ignored, one of them ends in `.ts`) —
      // they turned the lint red whenever they existed (fleet precedent govee-smart, 2026-09-08).
      ".remember/**",
      "admin",
      "node_modules",
      "**/adapter-config.d.ts",
    ],
  },
];
