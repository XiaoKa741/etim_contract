// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract ETIMNode is ERC721Enumerable, Ownable {
    // 供应量
    uint256 public constant MAX_SUPPLY = 500;
    // uri
    string public baseTokenURI = "https://d2clu30ecxbfyv.cloudfront.net/etimNode/";

    constructor() ERC721("ETIM NODE", "EtimNode") Ownable(msg.sender) {}

    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        return bytes(baseTokenURI).length > 0 ? string.concat(baseTokenURI, Strings.toString(tokenId), ".json") : "";
    }

    // 批量mint
    function batchMint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Address invalid");

        uint256 currentSupply = totalSupply();
        require(currentSupply + amount <= MAX_SUPPLY, "Exceeds max supply");

        for(uint256 i = 0; i < amount; i++) {
            // tokenId 从 1 开始
            _safeMint(to, currentSupply + i + 1);
        }
    }

    // 更新uri
    function updateURI(string memory uri) external onlyOwner {
        baseTokenURI = uri;
    }
}
