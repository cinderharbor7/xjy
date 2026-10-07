import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig(({ mode }) => {
  const publicEnv = loadEnv(mode, process.cwd(), "NEXT_PUBLIC_BOT_");
  return {
    root: "web",
    plugins: [tailwindcss()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    define: {
      "process.env.NEXT_PUBLIC_BOT_RPC_URL": JSON.stringify(
        publicEnv.NEXT_PUBLIC_BOT_RPC_URL || "",
      ),
      "process.env.NEXT_PUBLIC_BOT_REPORT_REGISTRY": JSON.stringify(
        publicEnv.NEXT_PUBLIC_BOT_REPORT_REGISTRY || "",
      ),
    },
    build: { outDir: "../dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
  };
});
