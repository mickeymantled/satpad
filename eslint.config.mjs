// Flat config. Keep rules minimal; strictness lives in tsconfig.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/target/**", ".fork-ledger/**", "idl-ref/**", "web/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Money is bigint. Flag accidental Number() on amounts in review; no lint rule can tell.
    },
  },
);
