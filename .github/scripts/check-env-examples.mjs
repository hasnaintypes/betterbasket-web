import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export function schemaKeys(source) {
  const file = ts.createSourceFile("config.ts", source, ts.ScriptTarget.Latest, true);
  let keys;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /envSchema$/i.test(node.name.text) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.arguments.length > 0 &&
      ts.isObjectLiteralExpression(node.initializer.arguments[0])
    ) {
      keys = node.initializer.arguments[0].properties
        .filter(ts.isPropertyAssignment)
        .map((property) => property.name.getText(file).replace(/^['"]|['"]$/g, ""));
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!keys?.length) throw new Error("No *EnvSchema = z.object({...}) found");
  return keys.sort();
}

export function exampleKeys(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
      if (!match) throw new Error(`Invalid example line: ${line}`);
      return match[1];
    })
    .sort();
}

export function checkApp(appDir) {
  const configPath = join(appDir, "src/config.ts");
  if (!existsSync(configPath)) return [];
  const expected = schemaKeys(readFileSync(configPath, "utf8"));
  const errors = [];
  for (const environment of ["development", "production"]) {
    const examplePath = join(appDir, `.env.${environment}.example`);
    if (!existsSync(examplePath)) {
      errors.push(`${examplePath}: missing example`);
      continue;
    }
    const actual = exampleKeys(readFileSync(examplePath, "utf8"));
    const missing = expected.filter((key) => !actual.includes(key));
    const extra = actual.filter((key) => !expected.includes(key));
    const duplicate = actual.filter((key, index) => actual.indexOf(key) !== index);
    if (missing.length || extra.length || duplicate.length) {
      errors.push(
        `${examplePath}: missing [${missing.join(", ")}], extra [${extra.join(", ")}], duplicate [${duplicate.join(", ")}]`,
      );
    }
  }
  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const appsDir = join(process.cwd(), "apps");
  const errors = readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => checkApp(join(appsDir, entry.name)));
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Environment examples match app schemas.");
  }
}
