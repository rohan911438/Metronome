// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {TestAUSD} from "../src/mocks/TestAUSD.sol";

contract TestAUSDTest is Test {
    TestAUSD internal token;

    function setUp() public {
        token = new TestAUSD();
    }

    function test_metadata() public view {
        assertEq(token.decimals(), 6);
        assertEq(token.symbol(), "tAUSD");
    }

    function test_anyoneMintsUpToMax() public {
        vm.prank(address(0xBEEF));
        token.mint(address(0xBEEF), 10_000_000e6);
        assertEq(token.balanceOf(address(0xBEEF)), 10_000_000e6);
    }

    function test_mintAboveMaxReverts() public {
        vm.expectRevert(abi.encodeWithSelector(TestAUSD.MintTooLarge.selector, 10_000_000e6 + 1, 10_000_000e6));
        token.mint(address(this), 10_000_000e6 + 1);
    }
}
