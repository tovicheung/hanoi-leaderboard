import { minify } from "terser";
import { join, basename } from "@std/path";

const SOURCE_DIR = "public/js";
const TARGET_DIR = "public/js-min";

try {
  await Deno.mkdir(TARGET_DIR, { recursive: true });
} catch (error) {
  if (!(error instanceof Deno.errors.AlreadyExists)) {
    console.error("Failed to create target directory:", error);
    Deno.exit(1);
  }
}

console.log(`Starting minification from ${SOURCE_DIR} to ${TARGET_DIR}`);

for await (const dirEntry of Deno.readDir(SOURCE_DIR)) {
  if (dirEntry.isFile && dirEntry.name.endsWith(".js")) {
    const sourcePath = join(SOURCE_DIR, dirEntry.name);
    const fileName = basename(dirEntry.name, ".js");
    const targetPath = join(TARGET_DIR, `${fileName}.min.js`);

    try {
      const code = await Deno.readTextFile(sourcePath);
      
      const result = await minify(code, {
        compress: {
          drop_console: false,
          hoist_funs: true,
        },
        mangle: true,
      });

      if (result.code) {
        await Deno.writeTextFile(targetPath, result.code);
        console.log(`✅ Minified: ${sourcePath} -> ${targetPath}`);
      } else {
        console.error(`❌ Failed to minify ${sourcePath}:`);
      }
    } catch (error) {
      console.error(`An error occurred processing ${sourcePath}:`, error);
    }
  }
}

console.log("Minification done");
