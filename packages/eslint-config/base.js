import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

/** Every model call goes through the LLM gateway in packages/llm; only it imports a vendor's SDK. */
export const modelSdkRestriction = {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@anthropic-ai/*", "openai", "openai/*", "@google/genai", "@google/generative-ai"],
            message: "Call models through the LLM gateway (@app/llm), which validates, routes and logs every call.",
          },
        ],
      },
    ],
  },
};

/** Shared lint rules for non-Next TypeScript packages. */
export default defineConfig([
  globalIgnores(["dist/**", "coverage/**"]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  modelSdkRestriction,
]);
