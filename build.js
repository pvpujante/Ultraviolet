import { rimraf } from "rimraf";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { build } from "esbuild";
import { execSync } from "node:child_process";

// read version from package.json
const pkg = JSON.parse(await readFile("package.json"));
process.env.ULTRAVIOLET_VERSION = pkg.version;

const isDevelopment = process.argv.includes("--dev");

await rimraf("dist");
await mkdir("dist");

// don't compile these files
await copyFile("src/sw.js", "dist/sw.js");
await copyFile("src/uv.config.js", "dist/uv.config.js");

let builder = await build({
	platform: "browser",
	sourcemap: true,
	minify: !isDevelopment,
	entryPoints: {
		"uv.bundle": "./src/rewrite/index.js",
		"uv.client": "./src/client/index.js",
		"uv.handler": "./src/uv.handler.js",
		"uv.sw": "./src/uv.sw.js",
	},
	define: {
		"process.env.ULTRAVIOLET_VERSION": JSON.stringify(
			process.env.ULTRAVIOLET_VERSION
		),
		"process.env.ULTRAVIOLET_COMMIT_HASH": (() => {
			try {
				let hash = JSON.stringify(
					execSync("git rev-parse --short HEAD", {
						encoding: "utf-8",
					}).replace(/\r?\n|\r/g, "")
				);

				return hash;
			} catch (e) {
				return "unknown";
			}
		})(),
	},
	bundle: true,
	treeShaking: true,
	metafile: isDevelopment,
	logLevel: "info",
	outdir: "dist/",
});
if (isDevelopment) {
	await writeFile("metafile.json", JSON.stringify(builder.metafile));

	const port = Number(process.env.PORT || 3000);
	const server = createServer((request, response) => {
		const requestPath = decodeURIComponent((request.url || "/").split("?")[0]);
		const relativePath = normalize(requestPath).replace(/^([.][.][/\\])+/, "");
		const filePath = join(process.cwd(), "dist", relativePath === "/" ? "uv.bundle.js" : relativePath);
		const contentType = {
			".js": "application/javascript; charset=utf-8",
			".json": "application/json; charset=utf-8",
			".map": "application/json; charset=utf-8",
		}[extname(filePath)] || "application/octet-stream";

		createReadStream(filePath)
			.on("error", () => {
				response.writeHead(404);
				response.end("Not found");
			})
			.on("open", () => response.writeHead(200, { "Content-Type": contentType }))
			.pipe(response);
	});

	server.listen(port, "0.0.0.0", () => {
		console.log(`Development server listening on port ${port}`);
	});
}
