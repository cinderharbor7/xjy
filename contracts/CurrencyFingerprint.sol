// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721URIStorage, ERC721} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Collectible, self-published market snapshots. Not a price oracle.
/// @dev Metadata is immutable after mint; no owner/admin mutation methods.
contract CurrencyFingerprint is ERC721URIStorage, ReentrancyGuard {
    uint256 public nextTokenId = 1;
    mapping(address => mapping(bytes32 => bool)) public minted;
    mapping(uint256 => bytes32) public metadataHash;
    event FingerprintMinted(address indexed collector, uint256 indexed tokenId, bytes32 indexed digest);

    constructor() ERC721("Currency Fingerprint", "CFP") {}

    function mint(string calldata uri) external nonReentrant returns (uint256 tokenId) {
        bytes memory raw = bytes(uri);
        require(raw.length > 29 && raw.length <= 18000, "Invalid metadata length");
        bytes memory prefix = bytes("data:application/json;base64,");
        for (uint256 i; i < prefix.length; ++i) require(raw[i] == prefix[i], "Data URI required");
        bytes32 digest = keccak256(raw);
        require(!minted[msg.sender][digest], "Already collected");
        minted[msg.sender][digest] = true;
        tokenId = nextTokenId++;
        metadataHash[tokenId] = digest;
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);
        emit FingerprintMinted(msg.sender, tokenId, digest);
    }
}
