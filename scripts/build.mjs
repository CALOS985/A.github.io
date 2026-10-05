/* 构建维护入口：仅维护源码，自动更新浏览器加载的压缩文件。 */
import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const local = (file) => path.join(root, file);
await mkdir(local("assets/vendor"), { recursive: true });
for (const [input, output] of [
  ["assets/app.js", "assets/app.min.js"],
  ["assets/live2d.js", "assets/live2d.min.js"],
  ["assets/effects.js", "assets/effects.min.js"],
  ["assets/backgrounds.css", "assets/backgrounds.min.css"],
  ["assets/resources.js", "assets/resources.min.js"],
  ["assets/directory.js", "assets/directory.min.js"],
  ["dongman.css", "assets/site.min.css"],
  [
    "node_modules/minisearch/dist/umd/index.js",
    "assets/vendor/minisearch.min.js",
  ],
]) {
  await build({
    entryPoints: [local(input)],
    outfile: local(output),
    minify: true,
    charset: "utf8",
    legalComments: "inline",
  });
}
await copyFile(
  local("node_modules/minisearch/LICENSE.txt"),
  local("assets/vendor/MiniSearch-LICENSE.txt"),
);
console.log("本地压缩资源已更新。index.html 可直接打开。");
