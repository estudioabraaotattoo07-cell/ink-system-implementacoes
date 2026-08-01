import { register } from "node:module";

// scripts/_harness/register-hook.mjs -> raiz do projeto é 2 níveis acima.
const ROOT = new URL("../../", import.meta.url).href;

register("./alias-hook.mjs", import.meta.url, { data: { root: ROOT } });
