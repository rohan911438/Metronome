// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {Metronome} from "../src/Metronome.sol";
import {TickMath} from "../src/lib/TickMath.sol";

/// @notice PRICE_MIN such that tick `centerTick` is priced at `refPriceE18` (whole quote per whole base).
function priceMinAt(uint256 refPriceE18, uint8 baseDecimals, uint8 quoteDecimals, uint256 centerTick)
    pure
    returns (uint256)
{
    // Raw quote per raw base, scaled by 1e36.
    uint256 refRaw = (refPriceE18 * 10 ** quoteDecimals * 1e36) / (1e18 * 10 ** baseDecimals);
    return (refRaw * 1e18) / TickMath.factor(centerTick);
}

/// @notice Deploys one Metronome market and writes its config to deployments/<chainId>.json.
/// @dev Config via env (all optional on testnet):
///      BASE_TOKEN, QUOTE_TOKEN   token addresses (testnet defaults: WMON, AUSD; the live testnet market uses Circle USDC)
///      REF_PRICE_E18             reference price of 1 base in quote, 18 decimals; placed at tick 2048 (default 0.025)
///      SHARDS                    book shards per batch (default 16)
///      MIN_ORDER_SIZE            base units (default 1e18 = 1 MON)
///      FEE_BPS, SETTLE_REWARD    default 5 bps, 0
///      OWNER                     default: the deployer
///      DEPLOYMENT_NAME           key in the JSON file (default "metronome")
///
///      forge script script/Deploy.s.sol --rpc-url monad_testnet --private-key $PRIVATE_KEY --broadcast
contract Deploy is Script {
    uint256 internal constant CENTER_TICK = 2048;

    function run() external returns (Metronome m) {
        (address base, address quote) = _tokens();
        uint256 refPrice = vm.envOr("REF_PRICE_E18", uint256(0.025e18));
        uint256 shards = vm.envOr("SHARDS", uint256(16));
        uint256 minOrderSize = vm.envOr("MIN_ORDER_SIZE", uint256(1e18));
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(5)));
        uint128 settleReward = uint128(vm.envOr("SETTLE_REWARD", uint256(0)));
        string memory name = vm.envOr("DEPLOYMENT_NAME", string("metronome"));

        uint256 priceMin = priceMinFor(refPrice, IERC20Metadata(base).decimals(), IERC20Metadata(quote).decimals());

        vm.startBroadcast();
        address owner = vm.envOr("OWNER", msg.sender);
        m = new Metronome(IERC20(base), IERC20(quote), priceMin, shards, minOrderSize, feeBps, settleReward, owner);
        vm.stopBroadcast();

        console.log("Metronome:", address(m));
        console.log("priceMin:", priceMin, "shards:", shards);
        // Only record real deployments, not dry runs.
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) _write(name, m, owner);
    }

    /// @notice PRICE_MIN such that tick CENTER_TICK is priced at `refPriceE18` (whole quote per whole base).
    function priceMinFor(uint256 refPriceE18, uint8 baseDecimals, uint8 quoteDecimals) public pure returns (uint256) {
        return priceMinAt(refPriceE18, baseDecimals, quoteDecimals, CENTER_TICK);
    }

    function _tokens() internal view returns (address base, address quote) {
        if (block.chainid == 10_143) {
            base = vm.envOr("BASE_TOKEN", address(0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541)); // WMON
            quote = vm.envOr("QUOTE_TOKEN", address(0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC)); // AUSD
        } else if (block.chainid == 143) {
            base = vm.envAddress("BASE_TOKEN"); // mainnet WMON: set explicitly
            quote = vm.envOr("QUOTE_TOKEN", address(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a)); // AUSD
        } else {
            base = vm.envAddress("BASE_TOKEN");
            quote = vm.envAddress("QUOTE_TOKEN");
        }
    }

    function _write(string memory name, Metronome m, address owner) internal {
        string memory obj = name;
        vm.serializeAddress(obj, "address", address(m));
        vm.serializeAddress(obj, "base", address(m.BASE()));
        vm.serializeAddress(obj, "quote", address(m.QUOTE()));
        // The app labels balances and prices with these (testnet may quote in USDC, mainnet in AUSD).
        vm.serializeString(obj, "quoteSymbol", IERC20Metadata(address(m.QUOTE())).symbol());
        vm.serializeUint(obj, "quoteDecimals", IERC20Metadata(address(m.QUOTE())).decimals());
        vm.serializeAddress(obj, "owner", owner);
        vm.serializeUint(obj, "priceMin", m.PRICE_MIN());
        vm.serializeUint(obj, "shards", m.SHARDS());
        vm.serializeUint(obj, "minOrderSize", m.MIN_ORDER_SIZE());
        string memory json = vm.serializeUint(obj, "deployBlock", block.number);

        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        if (!vm.exists(path)) vm.writeJson("{}", path);
        vm.writeJson(json, path, string.concat(".", name));
    }
}
