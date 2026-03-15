import config from "@iobroker/eslint-config";

export default [
  ...config,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Disable rules that are too strict for this project
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-floating-promises": "warn",
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/no-blank-blocks": "off",
      "jsdoc/tag-lines": "off",
      "jsdoc/check-tag-names": "off",
    },
  },
  {
    ignores: [
      "build/**",
      "node_modules/**",
      "test/**/*.js",
      "admin/**",
      "scripts/**",
      "*.config.js",
    ],
  },
];
