// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only native wrapper for the isolated Amoy liquidity fixture.
/// @dev Not an official Polygon token. Never deploy or use on mainnet.
contract TestWrappedPOL is ERC20 {
    constructor() ERC20("CantonStake TEST Wrapped POL", "testWPOL") {
        require(block.chainid == 80002 || block.chainid == 31337, "Testnet only");
    }
    receive() external payable { deposit(); }
    function deposit() public payable { _mint(msg.sender, msg.value); }
    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Native transfer failed");
    }
}
