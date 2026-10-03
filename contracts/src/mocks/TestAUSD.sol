// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet stand-in for AUSD (6 decimals) while Agora's testnet faucet is empty. Anyone can mint up to
///         MAX_MINT per call. It is not Agora's AUSD: Perpl and other apps don't accept it. Never deploy to mainnet.
contract TestAUSD is ERC20 {
    uint256 public constant MAX_MINT = 10_000_000e6;

    error MintTooLarge(uint256 amount, uint256 max);

    constructor() ERC20("Test AUSD", "tAUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT) revert MintTooLarge(amount, MAX_MINT);
        _mint(to, amount);
    }
}
