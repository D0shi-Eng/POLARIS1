// معاينة التصميم للمطوّر فقط: العارض الحقيقي فوق بدائل الاختبار في الذاكرة، في متصفّح عادي.
// لا تدخل حزمة المنتج ولا بناءه (vite.config.ts للمنتج لا يراها).

import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  clearScreen: false,
  // المنفذ من PORT إن عيّنه مشغّل المعاينة (جلسات متعدّدة)، وإلا 5199.
  server: { port: Number(process.env["PORT"] ?? 5199), strictPort: true, fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
});
