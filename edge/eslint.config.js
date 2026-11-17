import globals from "globals";
import pluginSecurity from "eslint-plugin-security";
import eslintConfigPrettier from "eslint-config-prettier";

/** Modelled on back/eslint.config.js. @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ["**/node_modules/**", "**/data/**", "**/.env*"],
  },

  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      security: pluginSecurity,
    },
    rules: {
      ...pluginSecurity.configs.recommended.rules,
      "security/detect-object-injection": "off",
      "security/detect-non-literal-regexp": "warn",
      "security/detect-unsafe-regex": "error",
      "security/detect-buffer-noassert": "error",
      // ffmpeg is the whole point of this app; it is always spawned with an
      // argument array and never through a shell
      "security/detect-child-process": "off",
      "security/detect-eval-with-expression": "error",
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-non-literal-require": "warn",
      "security/detect-possible-timing-attacks": "off",
      "security/detect-pseudoRandomBytes": "error",

      // Only src/log.js and scripts/ may print
      "no-console": "error",
      "no-debugger": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-undef": "error",
      "no-unreachable": "error",
      "no-constant-condition": ["warn", { checkLoops: false }],
      "no-duplicate-imports": "error",
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
      "prefer-arrow-callback": "warn",
      "no-param-reassign": "warn",
      "no-return-await": "error",
      "require-await": "warn",
      "no-async-promise-executor": "error",
      "prefer-promise-reject-errors": "error",
      complexity: ["warn", { max: 25 }],
      "max-depth": ["warn", { max: 5 }],
      "max-params": ["warn", { max: 6 }],
      "max-lines-per-function": ["warn", { max: 120, skipBlankLines: true, skipComments: true }],
      "no-template-curly-in-string": "error",
      "sort-imports": ["warn", { ignoreCase: true, ignoreDeclarationSort: true }],
    },
  },

  {
    files: ["src/log.js", "src/index.js", "scripts/**/*.js"],
    rules: { "no-console": "off" },
  },

  {
    files: ["test/**/*.js"],
    rules: { "no-console": "off", "max-lines-per-function": "off", "require-await": "off" },
  },

  {
    files: ["ecosystem.config.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },

  eslintConfigPrettier,
];
