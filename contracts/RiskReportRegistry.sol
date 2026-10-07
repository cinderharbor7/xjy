// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Hash-only attestations. Publication proves neither report truth nor investment safety.
/// @dev No owner, payable functions, upgrade path, external calls, or portfolio execution rights.
contract RiskReportRegistry {
    bytes32 public constant REGISTRY_ID = keccak256("xjy-risk-report-registry:v1");
    mapping(address publisher => mapping(bytes32 reportHash => uint256 timestamp)) public attestations;

    error EmptyReportHash();
    error AlreadyPublished();
    event ReportPublished(bytes32 indexed reportHash, address indexed publisher, uint256 timestamp);

    function publish(bytes32 reportHash) external {
        if (reportHash == bytes32(0)) revert EmptyReportHash();
        if (attestations[msg.sender][reportHash] != 0) revert AlreadyPublished();
        attestations[msg.sender][reportHash] = block.timestamp;
        emit ReportPublished(reportHash, msg.sender, block.timestamp);
    }
}
