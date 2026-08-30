import {defineConfig} from "vitest/config";

export default defineConfig({
	base: "./",
	server: {port: 1420, strictPort: true},
	build: {outDir: "dist", emptyOutDir: true},
	test: {environment: "happy-dom", globals: true},
});
