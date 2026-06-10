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
    // 외부 도구 디렉토리 (프로젝트 코드 아님)
    "mcp-shrimp-task-manager/**",
    "claude-agents-main/**",
    "AGENT/**",
    "eval/**",
    "logs/**",
    "scripts/**",
    "node_modules/**",
  ]),
]);

export default eslintConfig;
