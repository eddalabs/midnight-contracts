import js from "@eslint/js";
import plugin from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";
import pluginPrettier from "eslint-plugin-prettier";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: ["./tsconfig.json"]
      },
      // Without this, Node built-ins (process, Buffer, crypto, TextEncoder)
      // all raise no-undef under js.configs.recommended.
      globals: { ...globals.node }
    },
    plugins: {
      "@typescript-eslint": plugin,
      prettier: pluginPrettier
    },
    rules: {
      "prettier/prettier": "error",
      // Base no-unused-vars misreads TS: it flags parameter names inside type
      // signatures. Defer to the TypeScript-aware rule.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/promise-function-async": "off",
      "@typescript-eslint/no-redeclare": "off",
      "@typescript-eslint/no-invalid-void-type": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off"
    }
  },
  {
    ignores: ["src/managed/**"]
  }
];
