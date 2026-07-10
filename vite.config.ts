/*
 * @Author: 刘杰 2689450490@qq.com
 * @Date: 2026-06-29 16:50:43
 * @LastEditors: 刘杰 2689450490@qq.com
 * @LastEditTime: 2026-06-29 17:03:50
 * @FilePath: \demo\frontend\vite.config.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { VantResolver } from "@vant/auto-import-resolver";

const buildCommit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7)
  ?? process.env.GITHUB_SHA?.slice(0, 7)
  ?? `v${process.env.npm_package_version ?? "dev"}@${new Date().toISOString()}`;

export default defineConfig({
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
  plugins: [
    vue(),
    AutoImport({
      resolvers: [VantResolver()],
    }),
    Components({
      resolvers: [VantResolver()],
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: true,
    port: 3002,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
      },
    },
  },
});
