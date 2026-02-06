// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract ETIMNode is ERC721Enumerable, Ownable {
    uint256 public constant MAX_SUPPLY = 500;
    string public baseTokenURI;

    constructor() ERC721("ETIM NODE", "EtimNode") Ownable(msg.sender) {}

    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
    }

    function mint(uint256 amount) external {
        require(msg.sender != address(0), "Address invalid");

        uint256 currentSupply = totalSupply();
        require(currentSupply + amount <= MAX_SUPPLY, "Exceeds max supply");

        for(uint256 i = 0; i < amount; i++) {
            _safeMint(msg.sender, currentSupply + i + 1);
        }
    }

    function batchMint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Address invalid");

        uint256 currentSupply = totalSupply();
        require(currentSupply + amount <= MAX_SUPPLY, "Exceeds max supply");

        for(uint256 i = 0; i < amount; i++) {
            _safeMint(to, currentSupply + i + 1);
        }
    }

    function updateURI(string memory uri) external onlyOwner {
        baseTokenURI = uri;
    }
}
