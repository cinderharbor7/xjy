import { parseAbi, parseAbiItem } from "viem";

// Ethereum mainnet: ordinary Chainlink proxies, not the similarly named SVR feeds.
export const ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
export const USDC_USD_FEED = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";
export const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
export const UNISWAP_POOL_ADDRESS = "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640";

export const CHAINLINK_ABI = parseAbi([
  "function description() view returns (string)",
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

export const SWAP_EVENT = parseAbiItem("event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)");
export const UNISWAP_POOL_ABI = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
]);
