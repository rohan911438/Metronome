import { parseAbi } from "viem";

export { metronomeAbi, miniAmmAbi, sandwichLabAbi, mockErc20Abi } from "@/generated/abi";

/** WMON (WETH9-style) wrap/unwrap. */
export const wmonAbi = parseAbi(["function deposit() payable", "function withdraw(uint256 amount)"]);
