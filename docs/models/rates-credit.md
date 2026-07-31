# Rates and credit models

Implementation: [`rates-credit.ts`](../../src/lib/quant/rates-credit.ts).
Validation examples: [`rates-credit.test.ts`](../../src/lib/quant/rates-credit.test.ts).
Short-rate and yield inputs are annual decimals, time is years, and discounting
is continuous. Short-rate bond formulas treat supplied parameters as risk-neutral.

## Vasicek Gaussian short rate

- **Question answered.** How can a mean-reverting but possibly negative short
  rate evolve, and what zero-coupon bond price and current-short-rate sensitivity
  follow under risk-neutral parameters?
- **Equations.** $dr_t=\kappa(\theta-r_t)dt+\sigma dW_t$.
  Conditional mean is $\theta+(r_t-\theta)e^{-\kappa\Delta}$ and variance is
  $\sigma^2(1-e^{-2\kappa\Delta})/(2\kappa)$. For maturity $T$,
  $B=(1-e^{-\kappa T})/\kappa$ and
  $\log P=(\theta-\sigma^2/(2\kappa^2))(B-T)
  -\sigma^2B^2/(4\kappa)-Br_0$.
- **Units and conventions.** Rates/volatility are annual decimals, $\kappa$ is
  per year, and time is years. $P$ is per unit face; zero yield is
  $-\log(P)/T$. Reported duration is $-P^{-1}\partial P/\partial r_0=B$ and
  convexity is $P^{-1}\partial^2P/\partial r_0^2=B^2$.
- **Implementation.** Every step samples the exact conditional Gaussian rather
  than Euler. Semantic path/step transitions preserve fixed-seed prefixes.
  Results include all bounded rate paths, R-7 fan percentiles, negative-rate
  frequency, and analytical zero-coupon values for requested maturities.
- **Validation gate.** Exact deterministic transitions and path prefixes replay;
  empirical one-step mean/variance match analytical moments; zero-volatility
  bonds match integrated deterministic rates; duration/convexity identities
  hold; negative observations warn and unsupported contracts fail.
- **Worked intuition.** From 6% with long-run mean 4%, $\kappa=.5$, and a one-year
  horizon, the conditional mean is
  $.04+.02e^{-.5}\approx5.21\%$: mean reversion moves toward 4% without jumping
  there immediately.
- **Assumptions and limitations.** Parameters are constant and risk-neutral for
  pricing; the Gaussian distribution permits negative rates. The reported
  sensitivities move today's short rate while holding parameters fixed, not the
  whole yield curve in parallel. Calibration and market-price-of-risk conversion
  are outside this module.
- **Educational disclaimer.** Vasicek scenarios and bond values are educational,
  not rate forecasts, quotes, or fixed-income advice.

## Cox-Ingersoll-Ross nonnegative short rate

- **Question answered.** How can a mean-reverting short rate remain nonnegative,
  when can it touch zero, and what analytical zero-coupon price follows?
- **Equations.** $dr_t=\kappa(\theta-r_t)dt+\sigma\sqrt{r_t}dW_t$.
  The exact transition is $r_{t+\Delta}=cX$ with
  $c=\sigma^2(1-e^{-\kappa\Delta})/(4\kappa)$,
  $X\sim\chi'^2_d(\lambda)$,
  $d=4\kappa\theta/\sigma^2$, and
  $\lambda=4\kappa e^{-\kappa\Delta}r_t/
  [\sigma^2(1-e^{-\kappa\Delta})]$. The Feller condition is
  $2\kappa\theta\ge\sigma^2$.
- **Units and conventions.** Units match Vasicek, but current/long-run rates must
  be nonnegative. Bond price is $P=A(T)e^{-B(T)r_0}$ with the standard CIR
  $\gamma=\sqrt{\kappa^2+2\sigma^2}$ loadings; zero-volatility has a separate
  deterministic limit.
- **Implementation.** A noncentral chi-square transition preserves
  nonnegativity without clipping Euler. For degrees of freedom above one, the
  sampler uses a shifted normal square plus central gamma; otherwise it uses an
  exact Poisson-gamma mixture. Fans, analytical moments, Feller sides, and bond
  sensitivities are returned. A comparison request runs CIR and Vasicek on the
  same seed, time grid, path count, and bond maturities, then aligns fan and bond
  summaries. Model-specific semantic namespaces make this a distribution
  comparison rather than a paired-path claim.
- **Validation gate.** Every simulated rate is nonnegative and reproducible;
  empirical conditional moments match formulas; the zero-volatility bond limit
  agrees exactly; a Feller violation warns without altering parameters; zero
  remains allowed when theoretically attainable; aligned comparison rows preserve
  requested times/maturities and expose Vasicek negative-rate frequency beside
  CIR's minimum rate and Feller state.
- **Worked intuition.** With $\kappa=.5$, $\theta=.04$, and $\sigma=.30$,
  $2\kappa\theta=.04<.09=\sigma^2$, so Feller is violated. The sampler still
  keeps rates nonnegative, but the continuous process may visit zero.
- **Assumptions and limitations.** Parameters are constant and treated as
  risk-neutral. CIR rules out negative rates, may still have material mass near
  zero, and is a one-factor model. It does not fit a full initial curve, include
  stochastic risk premia, or calibrate parameters.
- **Educational disclaimer.** CIR output teaches positivity and mean reversion;
  it is not a rate forecast or bond recommendation.

## Nelson-Siegel yield-curve representation

- **Question answered.** What level, slope, curvature, and decay best summarize
  a cross-section of observed continuously compounded yields, and how do named
  factor shocks reshape it?
- **Equations.** For $x=T/\tau$,
  $y(T)=\beta_0+\beta_1(1-e^{-x})/x+
  \beta_2[(1-e^{-x})/x-e^{-x}]$. At $T=0$, loadings use the limit `(1,1,0)`.
  Fixed-$\tau$ factors solve ordinary least squares and RMSE is
  $\sqrt{n^{-1}\sum(y_i-\hat y_i)^2}$.
- **Units and conventions.** Maturity/decay are years; yields and named shock
  magnitudes are annual continuously compounded decimals. `level`, `slope`, and
  `curvature` are yield coefficients, not stochastic state processes.
- **Implementation.** Fixed decay gives one three-parameter linear solve. Free
  decay scans 121 log-spaced candidates from 0.05 to 30 years, then refines
  around the best with a log-scale golden-section search. Named shocks add to
  level, slope, or curvature for parallel up/down, steepening/flattening, or
  more/less curvature.
- **Validation gate.** At least three observations and distinct maturities are
  required; units/dimensions are checked; synthetic factors are recovered with
  fixed and fitted decay; named shocks change only their stated coefficient;
  reaching a decay boundary emits a calibration warning.
- **Worked intuition.** If level is 4% and slope is -2%, the very short yield is
  about $4\%-2\%=2\%$, while the very long yield approaches 4%. A positive
  curvature coefficient adds a hump mainly at medium maturities.
- **Assumptions and limitations.** This is a cross-sectional curve fit, not an
  arbitrage-free stochastic rate model. OLS weights every maturity equally,
  decay can be weakly identified, and no pricing instruments, bid/ask weights,
  dynamic factors, or uncertainty intervals are included.
- **Educational disclaimer.** Fitted and shocked curves are classroom
  representations, not live curves, forecasts, or trading advice.

## Constant and piecewise hazard-rate credit

- **Question answered.** Given deterministic default intensity and recovery,
  what are survival/default probabilities, expected loss, conditional default
  time, and a risky coupon bond's expected discounted cash flows?
- **Equations.** $H(T)=\int_0^T\lambda(u)du$,
  $S(T)=e^{-H(T)}$, and
  $P(a<\tau\le b)=S(a)-S(b)$. Undiscounted expected loss is
  $EAD(1-R)[1-S(T)]$. Scheduled bond cash flow at $t$ contributes
  $CF_tS(t)e^{-rt}$; recovery contributes
  $RF\int S(t)\lambda(t)e^{-rt}dt$ over each constant-hazard interval.
- **Units and conventions.** Hazard and risk-free discount rates are continuous
  annual decimals; time is years. Coupon rate is annual simple and paid equally
  by frequency. Recovery is fraction of par paid at default; probabilities are
  in `[0,1]` and exposure/face values share a currency.
- **Implementation.** Constant hazard or strictly ordered piecewise-constant
  segments integrate exactly. Evaluation points expose cumulative/interval
  default, expected recovery/loss, and default time conditional on default by
  the final horizon. Optional risky-bond scheduled and within-interval recovery
  PVs are returned separately and summed.
- **Validation gate.** Constant hazard satisfies $S(T)=e^{-\lambda T}$;
  piecewise cumulative hazards add by interval; interval defaults telescope to
  cumulative default; expected loss/recovery reconcile; exact simple risky-bond
  fixtures match; segment starts, cash-flow frequency, and horizons validate.
- **Worked intuition.** At constant $\lambda=2\%$ for five years,
  $S=e^{-.1}=90.48\%$ and default probability is 9.52%. With exposure 100 and
  40% recovery, expected undiscounted loss is
  $100(.60)(.0952)\approx5.71$.
- **Assumptions and limitations.** Hazard, recovery, exposure, and risk-free rate
  are deterministic and independent. Expected loss is undiscounted while bond
  PV is discounted. Defaults have no portfolio dependence, recovery is a fixed
  fraction of par, and hazard probabilities are not structural probabilities.
- **Educational disclaimer.** Hazard output illustrates reduced-form credit;
  it is not a credit rating, default forecast, or bond valuation opinion.

## Merton structural credit

- **Question answered.** If firm assets follow a lognormal diffusion and debt is
  due at one maturity, what are equity, risky debt, distance to default, physical
  and risk-neutral default probabilities, and implied credit spread?
- **Equations.** Equity is a call:
  $E=VN(d_1)-Fe^{-rT}N(d_2)$ with
  $d_1=[\ln(V/F)+(r+\sigma_V^2/2)T]/(\sigma_V\sqrt T)$ and
  $d_2=d_1-\sigma_V\sqrt T$. Risky debt is $D=V-E$;
  $PD_Q=N(-d_2)$. Distance to default is
  $DD=[\ln(V/F)+(\mu_V-\sigma_V^2/2)T]/(\sigma_V\sqrt T)$ and
  $PD_P=N(-DD)$.
- **Units and conventions.** Asset/debt/equity values share currency; $r$ and
  physical expected asset return are continuous annual decimals; volatility is
  annual; time is years. Spread is the continuous risky-debt yield minus $r$.
- **Implementation.** The code evaluates balance-sheet-equivalent call, risky
  debt, and debt-guarantee put values, clamps numerical probabilities/bounds,
  reports asset-to-equity delta $N(d_1)$, and separates pricing-measure from
  physical default. A zero-volatility branch avoids infinite distances and makes
  default deterministic.
- **Validation gate.** Black-Scholes fixtures agree; $V=E+D$ and
  default-free debt minus guarantee put equals risky debt; values remain within
  balance-sheet bounds; probabilities lie in `[0,1]`; zero-volatility safe/default
  cases stay finite and deterministic.
- **Worked intuition.** With zero volatility, $r=0$, physical expected return
  0, one year, assets 70, and debt face 80, equity is 0 and risky debt is 70.
  Default is certain at maturity under both measures in this limiting example;
  with assets 100, equity is 20 and debt is the full 80.
- **Assumptions and limitations.** Default can occur only at one debt maturity;
  firm asset value is assumed observable and lognormal; debt has one face value;
  rates/volatility are constant; and capital-structure complexity, coupons,
  early default, jumps, liquidity, and calibration error are omitted. Physical
  and risk-neutral probabilities answer different questions.
- **Educational disclaimer.** Merton results are structural-credit lessons, not
  issuer credit assessments, market prices, or investment advice.

## Further reading

See the bibliography for [rates and credit](references.md#rates-and-credit) and
[shared numerical foundations](references.md#shared-numerical-foundations).
