import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 前端根目录在 web/;dev 时把 /api 与 /ws 代理到后端(127.0.0.1:4317)。
// 生产构建产物输出到 ../dist/web,由后端 express 直接托管。
export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // 允许从 web/ 导入项目根下的 server/types.ts(共享类型)
    fs: { allow: [".."] },
    proxy: {
      "/api": { target: "http://127.0.0.1:4317", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:4317", ws: true },
    },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
});
