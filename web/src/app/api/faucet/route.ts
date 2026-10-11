/**
 * Testnet onboarding: a new passkey wallet holds no MON, so it can't pay gas for its first transaction (the RPC
 * rejects it, and viem reports "Missing or invalid parameters"). This route pays for it from our sponsor wallet:
 * a little MON for gas, and a request to Agora's AUSD faucet on the user's behalf.
 *
 * Testnet only, and only with FAUCET_PRIVATE_KEY set (server-side, never NEXT_PUBLIC). MON is sent only to wallets
 * holding under MIN_MON, and each address and IP gets one MON drip per COOLDOWN_MS (best effort: per instance).
 */
import { NextResponse, type NextRequest } from "next/server";
import { createPublicClient, createWalletClient, erc20Abi, formatEther, isAddress, parseAbi, parseEther, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { deployments } from "@/generated/deployments";
import { rpcTransport } from "@/lib/config";

export const dynamic = "force-dynamic";

const AUSD_FAUCET: Address = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C";
const faucetAbi = parseAbi(["function requestFunds(address to)", "error MaxFrequencyExceeded()"]);
const DRIP = parseEther("0.1");
const MIN_MON = parseEther("0.05");
const COOLDOWN_MS = 10 * 60_000;
const seen = new Map<string, number>();

const market = deployments[String(monadTestnet.id) as keyof typeof deployments];

export async function POST(req: NextRequest) {
  const key = process.env.FAUCET_PRIVATE_KEY as `0x${string}` | undefined;
  if (process.env.NEXT_PUBLIC_NETWORK !== "testnet" || !key) {
    return NextResponse.json({ error: "The faucet is only available on the hosted testnet app." }, { status: 404 });
  }
  const { address } = (await req.json().catch(() => ({}))) as { address?: string };
  if (!address || !isAddress(address)) return NextResponse.json({ error: "Invalid address." }, { status: 400 });

  const pub = createPublicClient({ chain: monadTestnet, transport: rpcTransport(), pollingInterval: 400 }); // Monad blocks are ~0.4 s
  const sponsor = createWalletClient({ account: privateKeyToAccount(key), chain: monadTestnet, transport: rpcTransport() });
  const result: { mon?: string; ausd?: string; notes: string[] } = { notes: [] };

  // Gas money first: without it the user can't do anything else.
  const monBalance = await pub.getBalance({ address });
  if (monBalance < MIN_MON) {
    // One MON drip per address and IP per cooldown; AUSD retries stay open (Agora's faucet rate-limits itself).
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const now = Date.now();
    for (const k of [address.toLowerCase(), ip]) {
      const last = seen.get(k);
      if (last && now - last < COOLDOWN_MS) {
        const mins = Math.ceil((COOLDOWN_MS - (now - last)) / 60_000);
        return NextResponse.json({ error: `This wallet or network was funded recently. Try again in ${mins} min.` }, { status: 429 });
      }
    }
    seen.set(address.toLowerCase(), now);
    seen.set(ip, now);
    const hash = await sponsor.sendTransaction({ to: address, value: DRIP });
    await pub.waitForTransactionReceipt({ hash });
    result.mon = hash;
  } else {
    result.notes.push(`Already has ${Number(formatEther(monBalance)).toFixed(3)} MON for gas.`);
  }

  // AUSD from Agora's faucet (10,000 per request, one request a minute across everyone).
  const quote = market?.quote as Address | undefined;
  const ausd = quote ? await pub.readContract({ address: quote, abi: erc20Abi, functionName: "balanceOf", args: [address] }) : 0n;
  if (ausd >= parseUnits("1000", 6)) {
    result.notes.push("Already has AUSD.");
  } else {
    try {
      const gas = await pub.estimateContractGas({
        account: sponsor.account,
        address: AUSD_FAUCET,
        abi: faucetAbi,
        functionName: "requestFunds",
        args: [address],
      });
      const hash = await sponsor.writeContract({
        address: AUSD_FAUCET,
        abi: faucetAbi,
        functionName: "requestFunds",
        args: [address],
        gas: (gas * 12n) / 10n, // Monad bills the gas limit
      });
      await pub.waitForTransactionReceipt({ hash });
      result.ausd = hash;
    } catch (e) {
      const msg = (e as Error).message;
      result.notes.push(
        msg.includes("MaxFrequencyExceeded")
          ? "Agora's AUSD faucet is busy (one request a minute for everyone). Tap again in a minute."
          : `AUSD faucet failed: ${msg.split("\n")[0]}`,
      );
    }
  }

  return NextResponse.json(result);
}
