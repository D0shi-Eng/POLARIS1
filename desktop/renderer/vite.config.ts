// إعداد البناء.
//
// مُصغَّر عمدًا: لا خوادم وكيلة، ولا متغيرات بيئة تُحقن في الحزمة، ولا أصول
// خارجية. القاعدة النسبية مطلوبة لأن المضيف يقدّم الملفات من بروتوكول أصول
// داخلي لا من جذر خادم.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "./",
  clearScreen: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome120",
    sourcemap: false,
    // اسم ثابت للأصول يجعل مقارنة بناءين أسهل، ولا حاجة إلى تفريغ ذاكرة وسيطة
    // في تطبيق لا يُقدَّم من شبكة.
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
        // حزم منفصلة: إطار React، وعقود العارض المُولَّدة (مخططات ومحقّقات)، والتطبيق. تتغيّر كلٌّ
        // بإيقاعها، ويُقاس حجم كلٍّ وحده.
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "vendor-react";
          if (id.includes("/src/generated/")) return "contracts";
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
