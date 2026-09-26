/**
 * A Perpl API key the user made at perpl.xyz/apikeys and pasted in: the opaque `X-API-Key` token plus the Ed25519
 * private key. (In-app enrollment, which would use the passkey-derived key from keys.ts, waits on Perpl whitelisting
 * our origin.)
 *
 * Storage: with a passkey account, the key is encrypted (AES-256-GCM) under the passkey-derived vault key before it
 * touches localStorage, so it can only be read after Face ID / fingerprint. A dev test account has no passkey, so its
 * key is kept in memory only. Requests are signed in the browser; the private key never leaves the device.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { Address } from "viem";
import { chain } from "./config";

export interface PerplApiKey {
  token: string;
  secret: Uint8Array;
  /** Hex of the Ed25519 public key, shown so the user can match it with perpl.xyz. */
  publicKey: string;
}

/** Validates pasted input. The private key is 32 bytes of hex, with or without 0x. */
export function parseApiKey(token: string, secretHex: string): PerplApiKey {
  const t = token.trim();
  const h = secretHex.trim().replace(/^0x/i, "");
  if (!t) throw new Error("Paste the API key token (X-API-Key) from Perpl.");
  if (/\s/.test(t)) throw new Error("The API key token can't contain spaces.");
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error("The private key should be 64 hex characters (32 bytes).");
  const secret = hexToBytes(h.toLowerCase());
  return { token: t, secret, publicKey: bytesToHex(ed25519.getPublicKey(secret)) };
}

const storeKey = (owner: Address) => `metronome.perpl.apikey.${chain.id}.${owner}`.toLowerCase();
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aesKey(vaultKey: Uint8Array) {
  return crypto.subtle.importKey("raw", vaultKey as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function saveApiKey(owner: Address, vaultKey: Uint8Array, key: PerplApiKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ token: key.token, secret: bytesToHex(key.secret) }));
  // The owner address is authenticated data: a blob copied to another account's slot won't decrypt.
  const aad = new TextEncoder().encode(owner.toLowerCase());
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, await aesKey(vaultKey), plain));
  localStorage.setItem(storeKey(owner), JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) }));
}

export async function loadApiKey(owner: Address, vaultKey: Uint8Array): Promise<PerplApiKey | null> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storeKey(owner));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const { iv, ct } = JSON.parse(raw) as { iv: string; ct: string };
    const aad = new TextEncoder().encode(owner.toLowerCase());
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: aad }, await aesKey(vaultKey), unb64(ct));
    const { token, secret } = JSON.parse(new TextDecoder().decode(plain)) as { token: string; secret: string };
    return parseApiKey(token, secret);
  } catch {
    return null; // unreadable with this passkey: treat as no key
  }
}

export function forgetApiKey(owner: Address) {
  try {
    localStorage.removeItem(storeKey(owner));
  } catch {
    // nothing stored
  }
}

const b64url = (b: Uint8Array) => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Perpl's request signature: Ed25519 over `chain_id \n METHOD \n target \n timestamp_ms \n nonce \n sha256(body) hex`.
 * `target` is the path after `/api`, including the query string exactly as sent.
 */
export function signRequest(key: PerplApiKey, chainId: number, method: string, target: string, body = "") {
  const timestamp = Date.now().toString();
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const canonical = [chainId, method, target, timestamp, nonce, bytesToHex(sha256(new TextEncoder().encode(body)))].join("\n");
  const signature = b64url(ed25519.sign(new TextEncoder().encode(canonical), key.secret));
  return {
    "X-API-Key": key.token,
    "X-API-Timestamp": timestamp,
    "X-API-Nonce": nonce,
    "X-API-Signature": signature,
  };
}

export type KeyCheck = { ok: true } | { ok: false; reason: "rejected" | "scope" | "unreachable"; detail: string };

/** Asks Perpl whether the key works by reading the key owner's wallet state (a read-scope call). */
export async function checkApiKey(key: PerplApiKey, chainId: number): Promise<KeyCheck> {
  const target = "/v1/trading/wallet";
  try {
    const r = await fetch(`/api/perpl${target}`, { headers: signRequest(key, chainId, "GET", target), cache: "no-store" });
    if (r.ok) return { ok: true };
    const detail = (await r.text().catch(() => "")).slice(0, 160);
    if (r.status === 401) return { ok: false, reason: "rejected", detail };
    if (r.status === 403) return { ok: false, reason: "scope", detail };
    return { ok: false, reason: "unreachable", detail: `HTTP ${r.status} ${detail}` };
  } catch (e) {
    return { ok: false, reason: "unreachable", detail: (e as Error).message };
  }
}
