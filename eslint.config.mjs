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
  // 언더스코어(_) 접두사는 "의도적으로 사용하지 않음"을 뜻하는 프로젝트 관례다.
  // 포트 인터페이스를 구현하는 no-op 어댑터처럼 인자를 지울 수 없는 경우에 쓴다.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
