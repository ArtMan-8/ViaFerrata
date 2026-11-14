import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import type { Nodes } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse);

export async function assertLocalLinks(root: string, files: string[]) {
  for (const file of files.filter((name) => name.endsWith(".md"))) {
    const tree = parser.parse(await fs.readFile(path.join(root, file), "utf8"));
    async function visit(node: Nodes) {
      if ("url" in node && node.url && !/^(?:[a-z][a-z\d+.-]*:|#)/i.test(node.url)) {
        const target = path.resolve(
          root,
          path.dirname(file),
          decodeURIComponent(node.url.split(/[?#]/)[0]),
        );
        const relative = path.relative(root, target);
        assert(
          !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith("../"),
          `${file}: ссылка выходит за пределы поставки: ${node.url}`,
        );
        assert((await fs.stat(target)).isFile(), `${file}: нет файла ${node.url}`);
      }
      for (const child of "children" in node ? node.children : []) {
        await visit(child);
      }
    }
    await visit(tree);
  }
}
