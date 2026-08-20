import crypto from "node:crypto";

function chaveCriptografia() {
  const valor = (process.env.INTEGRACOES_ENCRYPTION_KEY || "").trim();
  const chave = /^[a-f0-9]{64}$/i.test(valor) ? Buffer.from(valor, "hex") : Buffer.from(valor, "base64");
  if (chave.length !== 32) throw new Error("Configuração de criptografia indisponível.");
  return chave;
}

export function criptografarCredencial(texto: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", chaveCriptografia(), iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), cifrado.toString("base64url")].join(".");
}

export function descriptografarCredencial(valor: string) {
  const [versao, iv64, tag64, cifrado64] = String(valor || "").split(".");
  if (versao !== "v1" || !iv64 || !tag64 || !cifrado64) throw new Error("Credencial protegida inválida.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", chaveCriptografia(), Buffer.from(iv64, "base64url"));
  decipher.setAuthTag(Buffer.from(tag64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(cifrado64, "base64url")), decipher.final()]).toString("utf8");
}
