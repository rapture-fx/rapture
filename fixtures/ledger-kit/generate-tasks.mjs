import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const tasks = [
  {
    id: "fix-parse-money",
    description:
      "Fix parseMoney in src/money.ts. The current implementation strips non-digits and returns an integer, so $12.50 becomes 1250. parseMoney must accept an optional leading $, optional thousands commas, and a decimal cents field; return a finite dollar amount rounded half-up to two decimal places; and throw TypeError for empty, non-numeric, or otherwise invalid input. Do not change other modules.",
    file: "src/money.ts",
    solution: "solutions/money.ts",
    validation: "validation/money.ts",
  },
  {
    id: "add-volume-discount",
    description:
      "Implement applyVolumeDiscount(subtotal, quantity) in src/discount.ts. Quantities 0-9 have no discount, 10-49 receive 5%, and 50 or more receive 10%. Return the discounted subtotal rounded half-up to two decimal places. Throw RangeError for negative or non-finite inputs. Do not change other modules.",
    file: "src/discount.ts",
    solution: "solutions/discount.ts",
    validation: "validation/discount.ts",
  },
  {
    id: "validate-sku",
    description:
      "Change createSku(department, id) in src/sku.ts so it only accepts a 3-letter uppercase department and a 4-digit id. Valid input returns DEPARTMENT-ID. Throw TypeError for empty values, lowercase departments, wrong lengths, or non-digit ids. Do not change other modules.",
    file: "src/sku.ts",
    solution: "solutions/sku.ts",
    validation: "validation/sku.ts",
  },
  {
    id: "one-based-pagination",
    description:
      "Change pageSlice(items, page, pageSize) in src/pagination.ts from 0-based pages to 1-based pages. Page 1 must return the first pageSize items. Throw RangeError when page is not a 1-based integer or pageSize is not a positive integer. Do not change other modules.",
    file: "src/pagination.ts",
    solution: "solutions/pagination.ts",
    validation: "validation/pagination.ts",
  },
  {
    id: "extract-normalize-email",
    description:
      "Refactor src/email.ts by extracting and exporting normalizeEmail(email) that trims whitespace and lowercases the address. formatContact and emailKey must keep their current behavior and use that helper. Do not change other modules.",
    file: "src/email.ts",
    solution: "solutions/email.ts",
    validation: "validation/email.ts",
  },
  {
    id: "parse-config-comments",
    description:
      "Update parseConfig(text) in src/config.ts to skip empty lines and # comments, trim keys, support double-quoted values that may contain #, treat duplicate keys as last-wins, and throw SyntaxError for a non-comment line without =. Do not change other modules.",
    file: "src/config.ts",
    solution: "solutions/config.ts",
    validation: "validation/config.ts",
  },
];

const generated = {
  tasks: await Promise.all(
    tasks.map(async (task) => ({
      id: task.id,
      description: task.description,
      baseCommit: "HEAD",
      validation: [`node --experimental-strip-types --no-warnings ${task.validation}`],
      timeoutSeconds: 180,
      independent: true,
      dependsOn: [],
      fake: {
        files: {
          [task.file]: await readFile(join(root, task.solution), "utf8"),
        },
        delayMs: 40,
      },
    })),
  ),
};

const destination = join(root, "tasks.json");
await writeFile(destination, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
process.stdout.write(`${destination}\n`);
