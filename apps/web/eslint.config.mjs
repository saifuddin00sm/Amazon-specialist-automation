import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // As in packages/eslint-config: every model call goes through the LLM gateway in packages/llm.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@anthropic-ai/*", "openai", "openai/*", "@google/genai", "@google/generative-ai", "@app/llm/*"],
              message: "The UI never calls models. Agents call them through the LLM gateway (@app/llm) in the backend.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
