import { createEncryptedVault, decryptVault, encryptVaultWithKey } from "./crypto.js";

export async function hasVault() {
  const { vaultData } = await chrome.storage.local.get("vaultData");
  return Boolean(vaultData);
}
export async function createVault(password, accounts) {
  const { key, payload } = await createEncryptedVault(password, accounts);
  await chrome.storage.local.set({ vaultData: payload, failedUnlocks: 0, nextUnlockAt: 0, lastVaultChangeAt: Date.now() });
  return key;
}
export async function unlockVault(password) {
  const { vaultData, failedUnlocks = 0, nextUnlockAt = 0 } = await chrome.storage.local.get(["vaultData", "failedUnlocks", "nextUnlockAt"]);
  if (!vaultData) throw new Error("Cofre não encontrado.");
  if (Date.now() < nextUnlockAt) {
    const wait = Math.ceil((nextUnlockAt - Date.now()) / 1000);
    throw new Error(`Aguarde ${wait} segundos antes de tentar novamente.`);
  }
  try {
    const result = await decryptVault(password, vaultData);
    if (!Array.isArray(result.accounts)) throw new Error("Formato do cofre inválido.");
    if (result.legacy) {
      const migrated = await encryptVaultWithKey(result.key, result.accounts, result.salt);
      await chrome.storage.local.set({ vaultData: migrated });
    }
    await chrome.storage.local.set({ failedUnlocks: 0, nextUnlockAt: 0 });
    return result;
  } catch (error) {
    if (error.message?.startsWith("Aguarde ")) throw error;
    const attempts = Math.min(Number(failedUnlocks) + 1, 8);
    const delay = attempts < 3 ? 0 : Math.min(60_000, 2 ** (attempts - 3) * 5_000);
    await chrome.storage.local.set({ failedUnlocks: attempts, nextUnlockAt: Date.now() + delay });
    throw new Error(delay ? `Senha incorreta. Aguarde ${Math.ceil(delay / 1000)} segundos.` : "Senha incorreta ou cofre danificado.");
  }
}
export async function saveVault(key, accounts) {
  const { vaultData } = await chrome.storage.local.get("vaultData");
  if (!vaultData?.salt) throw new Error("Cofre não encontrado.");
  // Reutiliza o salt da derivação; cada gravação usa um IV aleatório novo.
  const payload = await encryptVaultWithKey(key, accounts, vaultData.salt);
  await chrome.storage.local.set({ vaultData: payload, lastVaultChangeAt: Date.now() });
}
export async function replaceVaultWithAccounts(key, accounts) {
  return saveVault(key, accounts);
}
