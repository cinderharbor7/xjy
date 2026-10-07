# ETH Crash Risk Lab

`/risk-lab` is a demo research surface for an ETH crash-risk study. It keeps the observation contract, model outputs, decision rule, and limitations visible in one place. The current fixture is deterministic and intentionally labelled `MOCK_CHAIN_FIXTURE`; it does not claim a live RPC read or fitted live performance.

## Current signal contract

The fixture covers blocks `23,413,920` to `23,500,120` and a 24-hour DEX sell-pressure window. The sell-pressure observation is validated through `OnchainSignalStateSchema`: gross ETH sell volume, the previous-window baseline, anomaly ratio, transaction count, unique wallets, and block/event references are kept together. The UI also shows volatility, run-up, leverage growth, stablecoin depth gap, and an explosive-dynamics proxy so that short and slow moving risks are not mixed without explanation.

## Model layers

| Layer | Decision basis | Output shown | Reference |
| --- | --- | --- | --- |
| Threshold early warning | Weighted threshold signals with explicit watch cutoffs | Active signal count and score | Kaminsky (1998); Drehmann & Juselius (2014) |
| Rolling logit | Lagged run-up, volatility, sell pressure and leverage | Probability of a 10-day drawdown of at least 12% | Chen, Hong & Stein (2001); Beutel et al. (2019) |
| Explosive dynamics | GSADF-style right-tail statistic over recursive windows | Bubble-state score | Phillips, Shi & Yu (2015) |
| Liquidity regime | State-dependent response to a sell/liquidity shock | Fragile-regime score | Acharya, Amihud & Bharath (2013); Jiang et al. (2022) |
| Left-tail quantile | Conditional 5% return estimate | 10-day q05 loss estimate | Baron & Xiong (2017); Kalyvas (2020) |

The model scores are deterministic proxies. The displayed crash/regime probabilities and tail quantile are illustrative placeholders, not fitted estimates or the result of out-of-sample evaluation.

The composite is a fixed weighted average of the five scores. Confidence is a separate weighted average of model confidence values; it is not the probability that the market must crash. The recommendation uses model agreement to set an exposure budget: reduce ETH exposure by 20–30 percentage points, pause new leverage, and retain stablecoin liquidity. The page does not execute a swap.

## Evidence and research boundary

Observed fields keep block and transaction/event references. Derived fields identify their horizon and source. The limitation record states that this demo has no live refresh, coefficient standard errors, calibration, AUC, false-alarm rate, or lead-time estimate. A production empirical study should replace the fixture with an indexed ETH panel, use only lagged inputs, fit and evaluate recursively out of sample, and report those metrics before any position rule is relied upon.
