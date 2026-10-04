// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Metronome} from "../src/Metronome.sol";
import {IMetronome} from "../src/interfaces/IMetronome.sol";
import {priceMinAt} from "../script/Deploy.s.sol";

interface IWMON {
    function deposit() external payable;
}

/// @notice The real mainnet tokens on a fork of Monad mainnet: real WMON (WETH9-style) and real AUSD (upgradeable
///         proxy, 6 decimals). Checks that escrow, settle and claim move exactly what they should with them.
///         Skipped unless MONAD_RPC_URL is set:  MONAD_RPC_URL=https://rpc.monad.xyz forge test --mc MainnetFork
contract MainnetForkTest is Test {
    IERC20 internal constant WMON = IERC20(0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A);
    IERC20 internal constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    uint16 internal constant T = 2048; // the reference price, 0.0315 AUSD per MON

    Metronome internal m;
    address internal maker = makeAddr("maker");
    address internal taker = makeAddr("taker");
    address internal seller = makeAddr("seller");

    function setUp() public {
        string memory rpc = vm.envOr("MONAD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 143);

        m = new Metronome(WMON, AUSD, priceMinAt(0.0315e18, 18, 6, T), 4, 1e18, 5, 0, address(this));
        _wrap(maker, 10_000e18);
        _wrap(seller, 1000e18);
        _fundAusd(taker, 1000e6);
        for (uint256 i; i < 3; ++i) {
            address u = [maker, taker, seller][i];
            vm.startPrank(u);
            WMON.approve(address(m), type(uint256).max);
            AUSD.approve(address(m), type(uint256).max);
            vm.stopPrank();
        }
    }

    /// @dev Real WMON, minted the real way: native MON wrapped with deposit().
    function _wrap(address to, uint256 amount) internal {
        vm.deal(to, amount);
        vm.prank(to);
        IWMON(address(WMON)).deposit{value: amount}();
    }

    /// @dev AUSD keeps balances in proxy storage that `deal` can't locate, so take it from a large holder (seen on
    ///      mainnet on Oct 4, 2026; the first one that still holds enough).
    function _fundAusd(address to, uint256 amount) internal {
        address[3] memory holders = [
            0x34B6552d57a35a1D042CcAe1951BD1C370112a6F,
            0xdeBFeDF35faEd5d1664E553545e144C02227A2Ec,
            0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e
        ];
        for (uint256 i; i < holders.length; ++i) {
            if (AUSD.balanceOf(holders[i]) >= amount) {
                vm.prank(holders[i]);
                AUSD.transfer(to, amount);
                return;
            }
        }
        revert("no AUSD holder with enough balance; refresh the list");
    }

    function _next() internal {
        vm.roll(block.number + 1);
    }

    function test_realTokens_restingAskTakerBuyAndTakerSell() public {
        // A maker rests 10k MON at the reference price; it joins the book when its batch settles.
        vm.prank(maker);
        bytes32 ask = m.placeOrder(false, T, 10_000e18, true);
        assertEq(WMON.balanceOf(address(m)), 10_000e18, "WMON escrowed");
        uint256 batch0 = block.number;
        _next();
        m.settle(batch0);

        // A taker buys 5k MON with a 1% limit; a seller sells 500 MON into the buyer in the same batch.
        uint256 takerAusd = AUSD.balanceOf(taker);
        vm.prank(taker);
        bytes32 buy = m.placeOrder(true, T + 10, 5000e18, false);
        vm.prank(seller);
        bytes32 sell = m.placeOrder(false, T - 10, 500e18, false);
        uint256 batch1 = block.number;
        _next();
        m.settle(batch1);
        IMetronome.BatchResult memory r = m.getBatchResult(batch1);
        assertEq(r.clearingTick, T, "clears at the resting price");
        assertEq(r.volume, 5000e18);

        (uint256 got, uint256 refund) = m.claim(buy);
        assertEq(got, 5000e18);
        assertEq(WMON.balanceOf(taker), 5000e18, "taker got real WMON");
        // 5,000 MON at 0.0315 is 157.5 AUSD, plus the 5 bps taker fee.
        uint256 paid = takerAusd - AUSD.balanceOf(taker);
        assertApproxEqRel(paid, 157.5e6 + 157.5e6 * 5 / 10_000, 0.001e18);
        assertGt(refund, 0, "escrow at the 1% limit was refunded down to the clearing price");

        (uint256 baseBack, uint256 proceeds) = m.claim(sell);
        assertEq(baseBack, 0);
        assertApproxEqRel(proceeds, 15.75e6 - 15.75e6 * 5 / 10_000, 0.001e18);

        // The maker sold 4,500 MON to the taker (500 came from the seller) and keeps 5,500 resting.
        (, uint256 makerAusd) = m.claim(ask);
        assertApproxEqRel(makerAusd, 141.75e6, 0.001e18);
        vm.prank(maker);
        (uint256 back,) = m.cancel(ask);
        assertEq(back, 5500e18);

        // Everything paid out: the exchange keeps only fees, in AUSD, and no WMON.
        assertEq(WMON.balanceOf(address(m)), 0, "no WMON left behind");
        assertLt(AUSD.balanceOf(address(m)), 0.2e6, "only fees and rounding left");
    }
}
