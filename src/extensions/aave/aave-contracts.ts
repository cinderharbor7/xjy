import { AaveV3Ethereum } from "@aave-dao/aave-address-book";
import { parseAbi } from "viem";

// Ethereum mainnet Aave V3 Core; addresses come from the pinned official address book.
export const AAVE_PROVIDER_ADDRESS = AaveV3Ethereum.POOL_ADDRESSES_PROVIDER;
export const ETH_ASSET_ADDRESS = AaveV3Ethereum.ASSETS.WETH.UNDERLYING;
export const ETH_PRICE_LOOKBACK_BLOCKS = 7_200;

export const AAVE_PROVIDER_ABI = parseAbi([
  "function getPool() view returns (address)",
  "function getPriceOracle() view returns (address)",
]);

export const AAVE_POOL_ABI = parseAbi([
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
]);

export const AAVE_ORACLE_ABI = parseAbi([
  "function BASE_CURRENCY() view returns (address)",
  "function BASE_CURRENCY_UNIT() view returns (uint256)",
  "function getAssetPrice(address asset) view returns (uint256)",
]);
