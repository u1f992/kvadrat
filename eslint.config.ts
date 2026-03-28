import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * @see https://typescript-eslint.io/getting-started
 */
const eslintConfig = defineConfig(
  { ignores: ["**/dist/", "**/node_modules/", "src/wasm/", "u1f992-temp/"] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  // https://eslint.org/docs/latest/use/configure/migration-guide#configure-language-options
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["packages/web/**/*.{js,ts}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
);

export default eslintConfig;
