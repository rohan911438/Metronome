/**
 * One passkey, many keys. Mera gives us 32 secret bytes from the passkey (the WebAuthn PRF output); every key the app
 * needs is derived from them, each on its own path, so nothing is ever stored and a synced passkey on a new device
 * recovers all of them.
 *
 *   Monad wallet      BIP-39 mnemonic from the PRF bytes → BIP-44 m/44'/60'/0'/0/0 (secp256k1), same as Mera's recipe
 *   sub-account i     m/44'/60'/0'/0/i
 *   Perpl API key     Ed25519 seed = HKDF-SHA256(PRF bytes, salt "metronome", info "perpl-api-key/v1")
 *
 * The HKDF label keeps the Perpl key cryptographically independent of the wallet key: leaking one reveals nothing
 * about the other.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { Hex } from "viem";

export const walletPath = (index = 0) => `m/44'/60'/0'/0/${index}`;

export interface DerivedKeys {
  /** secp256k1 private keys, index 0 is the main wallet. */
  walletKey(index?: number): Uint8Array;
  /** Ed25519 key pair for signing Perpl API requests. */
  perpl: { secretKey: Uint8Array; publicKey: Hex };
}

export function deriveKeys(prfOutput: Uint8Array): DerivedKeys {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const root = HDKey.fromMasterSeed(seed);
  const perplSecret = hkdf(sha256, prfOutput, new TextEncoder().encode("metronome"), new TextEncoder().encode("perpl-api-key/v1"), 32);
  return {
    walletKey(index = 0) {
      const k = root.derive(walletPath(index)).privateKey;
      if (!k) throw new Error("key derivation produced no key");
      return k;
    },
    perpl: { secretKey: perplSecret, publicKey: `0x${bytesToHex(ed25519.getPublicKey(perplSecret))}` },
  };
}
