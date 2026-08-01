// Resolve hook só para o harness de testes (node --import) — reproduz o
// alias "@/*" -> raiz do projeto, do jeito que o tsconfig.json (bundler do
// Next.js) já resolve em produção. Não afeta o build real, só a execução
// direta via `node` fora do Next.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

let ROOT;
const EXTENSOES = ["", ".ts", ".tsx", ".js", ".jsx"];

export function initialize(data) {
  ROOT = data.root;
}

function resolverComExtensao(urlSemExtensao) {
  for (const ext of EXTENSOES) {
    const candidato = urlSemExtensao + ext;
    if (existsSync(fileURLToPath(candidato))) return candidato;
  }
  return urlSemExtensao;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = resolverComExtensao(new URL(specifier.slice(2), ROOT).href);
    return nextResolve(target, context);
  }
  return nextResolve(specifier, context);
}
