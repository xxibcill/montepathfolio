# References and further reading

This bibliography is a study map for the mathematical ideas used by the
laboratories. The implementation notes remain authoritative for the repository's
actual conventions, discretizations, finite-sample rules, and simplifying
choices; citing a source does not imply that every extension in that source is
implemented here.

## Shared numerical foundations

- Hyndman, R. J., and Fan, Y. (1996). “Sample Quantiles in Statistical
  Packages.” *The American Statistician*, 50(4), 361–365.
  [DOI: 10.2307/2684934](https://doi.org/10.2307/2684934). The repository uses
  their Type 7/R-7 linear quantile convention.
- Higham, N. J. (2002). *Accuracy and Stability of Numerical Algorithms*, 2nd
  ed. SIAM. [DOI: 10.1137/1.9780898718027](https://doi.org/10.1137/1.9780898718027).
  A foundation for reasoning about conditioning, factorization, and numerical
  error rather than accepting finite output as proof of correctness.
- Devroye, L. (1986). *Non-Uniform Random Variate Generation*. Springer.
  [Author-hosted edition](https://luc.devroye.org/rnbookindex.html). A classic
  source for normal, gamma, Poisson, and other sampling methods.

## Portfolio and market models

- Merton, R. C. (1976). “Option Pricing When Underlying Stock Returns Are
  Discontinuous.” *Journal of Financial Economics*, 3(1–2), 125–144.
  [DOI: 10.1016/0304-405X(76)90022-2](https://doi.org/10.1016/0304-405X(76)90022-2).
- Bollerslev, T. (1986). “Generalized Autoregressive Conditional
  Heteroskedasticity.” *Journal of Econometrics*, 31(3), 307–327.
  [DOI: 10.1016/0304-4076(86)90063-1](https://doi.org/10.1016/0304-4076(86)90063-1).
- Hamilton, J. D. (1989). “A New Approach to the Economic Analysis of
  Nonstationary Time Series and the Business Cycle.” *Econometrica*, 57(2),
  357–384. [DOI: 10.2307/1912559](https://doi.org/10.2307/1912559).
- Efron, B. (1979). “Bootstrap Methods: Another Look at the Jackknife.” *The
  Annals of Statistics*, 7(1), 1–26.
  [DOI: 10.1214/aos/1176344552](https://doi.org/10.1214/aos/1176344552).
- Künsch, H. R. (1989). “The Jackknife and the Bootstrap for General Stationary
  Observations.” *The Annals of Statistics*, 17(3), 1217–1241.
  [DOI: 10.1214/aos/1176347265](https://doi.org/10.1214/aos/1176347265).
- Nelsen, R. B. (2006). *An Introduction to Copulas*, 2nd ed. Springer.
  [DOI: 10.1007/0-387-28678-0](https://doi.org/10.1007/0-387-28678-0).

## Risk and retirement

- Artzner, P., Delbaen, F., Eber, J.-M., and Heath, D. (1999). “Coherent
  Measures of Risk.” *Mathematical Finance*, 9(3), 203–228.
  [DOI: 10.1111/1467-9965.00068](https://doi.org/10.1111/1467-9965.00068).
- Rockafellar, R. T., and Uryasev, S. (2000). “Optimization of Conditional
  Value-at-Risk.” *The Journal of Risk*, 2(3), 21–41.
  [DOI: 10.21314/JOR.2000.038](https://doi.org/10.21314/JOR.2000.038).
- Kupiec, P. H. (1995). “Techniques for Verifying the Accuracy of Risk
  Measurement Models.” *The Journal of Derivatives*, 3(2), 73–84.
  [DOI: 10.3905/jod.1995.407942](https://doi.org/10.3905/jod.1995.407942).
- Dybvig, P. H. (1995). “Duesenberry's Ratcheting of Consumption: Optimal
  Dynamic Consumption and Investment Given Intolerance for Any Decline in
  Standard of Living.” *The Review of Economic Studies*, 62(2), 287–313.
  [DOI: 10.2307/2297806](https://doi.org/10.2307/2297806). Useful context for
  dynamic spending rules; the repository implements a simpler teaching rule.

## Portfolio construction

- Markowitz, H. (1952). “Portfolio Selection.” *The Journal of Finance*, 7(1),
  77–91. [DOI: 10.2307/2975974](https://doi.org/10.2307/2975974).
- Sharpe, W. F. (1964). “Capital Asset Prices: A Theory of Market Equilibrium
  under Conditions of Risk.” *The Journal of Finance*, 19(3), 425–442.
  [DOI: 10.2307/2977928](https://doi.org/10.2307/2977928).
- Fama, E. F., and French, K. R. (1993). “Common Risk Factors in the Returns on
  Stocks and Bonds.” *Journal of Financial Economics*, 33(1), 3–56.
  [DOI: 10.1016/0304-405X(93)90023-5](https://doi.org/10.1016/0304-405X(93)90023-5).
- Maillard, S., Roncalli, T., and Teïletche, J. (2010). “The Properties of
  Equally Weighted Risk Contribution Portfolios.” *The Journal of Portfolio
  Management*, 36(4), 60–70.
  [DOI: 10.3905/jpm.2010.36.4.060](https://doi.org/10.3905/jpm.2010.36.4.060).
- Kelly, J. L., Jr. (1956). “A New Interpretation of Information Rate.” *Bell
  System Technical Journal*, 35(4), 917–926.
  [DOI: 10.1002/j.1538-7305.1956.tb03809.x](https://doi.org/10.1002/j.1538-7305.1956.tb03809.x).
- Black, F., and Litterman, R. (1992). “Global Portfolio Optimization.”
  *Financial Analysts Journal*, 48(5), 28–43.
  [DOI: 10.2469/faj.v48.n5.28](https://doi.org/10.2469/faj.v48.n5.28).

## Derivatives

- Black, F., and Scholes, M. (1973). “The Pricing of Options and Corporate
  Liabilities.” *Journal of Political Economy*, 81(3), 637–654.
  [DOI: 10.1086/260062](https://doi.org/10.1086/260062).
- Merton, R. C. (1973). “Theory of Rational Option Pricing.” *The Bell Journal
  of Economics and Management Science*, 4(1), 141–183.
  [DOI: 10.2307/3003143](https://doi.org/10.2307/3003143).
- Cox, J. C., Ross, S. A., and Rubinstein, M. (1979). “Option Pricing: A
  Simplified Approach.” *Journal of Financial Economics*, 7(3), 229–263.
  [DOI: 10.1016/0304-405X(79)90015-1](https://doi.org/10.1016/0304-405X(79)90015-1).
- Heston, S. L. (1993). “A Closed-Form Solution for Options with Stochastic
  Volatility with Applications to Bond and Currency Options.” *The Review of
  Financial Studies*, 6(2), 327–343.
  [DOI: 10.1093/rfs/6.2.327](https://doi.org/10.1093/rfs/6.2.327).
- Glasserman, P. (2004). *Monte Carlo Methods in Financial Engineering*.
  Springer. [DOI: 10.1007/978-0-387-21617-1](https://doi.org/10.1007/978-0-387-21617-1).

## Rates and credit

- Vasicek, O. (1977). “An Equilibrium Characterization of the Term Structure.”
  *Journal of Financial Economics*, 5(2), 177–188.
  [DOI: 10.1016/0304-405X(77)90016-2](https://doi.org/10.1016/0304-405X(77)90016-2).
- Cox, J. C., Ingersoll, J. E., Jr., and Ross, S. A. (1985). “A Theory of the
  Term Structure of Interest Rates.” *Econometrica*, 53(2), 385–407.
  [DOI: 10.2307/1911242](https://doi.org/10.2307/1911242).
- Nelson, C. R., and Siegel, A. F. (1987). “Parsimonious Modeling of Yield
  Curves.” *The Journal of Business*, 60(4), 473–489.
  [DOI: 10.1086/296409](https://doi.org/10.1086/296409).
- Merton, R. C. (1974). “On the Pricing of Corporate Debt: The Risk Structure
  of Interest Rates.” *The Journal of Finance*, 29(2), 449–470.
  [DOI: 10.1111/j.1540-6261.1974.tb03058.x](https://doi.org/10.1111/j.1540-6261.1974.tb03058.x).
- Duffie, D., and Singleton, K. J. (1999). “Modeling Term Structures of
  Defaultable Bonds.” *The Review of Financial Studies*, 12(4), 687–720.
  [DOI: 10.1093/rfs/12.4.687](https://doi.org/10.1093/rfs/12.4.687).

## Trading and microstructure

- Uhlenbeck, G. E., and Ornstein, L. S. (1930). “On the Theory of the Brownian
  Motion.” *Physical Review*, 36, 823–841.
  [DOI: 10.1103/PhysRev.36.823](https://doi.org/10.1103/PhysRev.36.823).
- Glosten, L. R., and Milgrom, P. R. (1985). “Bid, Ask and Transaction Prices in
  a Specialist Market with Heterogeneously Informed Traders.” *Journal of
  Financial Economics*, 14(1), 71–100.
  [DOI: 10.1016/0304-405X(85)90044-3](https://doi.org/10.1016/0304-405X(85)90044-3).
- Almgren, R., and Chriss, N. (2001). “Optimal Execution of Portfolio
  Transactions.” *The Journal of Risk*, 3(2), 5–39.
  [DOI: 10.21314/JOR.2001.041](https://doi.org/10.21314/JOR.2001.041).
- Gould, M. D., Porter, M. A., Williams, S., McDonald, M., Fenn, D. J., and
  Howison, S. D. (2013). “Limit Order Books.” *Quantitative Finance*, 13(11),
  1709–1742.
  [DOI: 10.1080/14697688.2013.803148](https://doi.org/10.1080/14697688.2013.803148).

## How to use these sources

Start with the equation and worked example in the relevant model note, reproduce
one limiting case by hand, and then consult the paper or book for derivation and
context. Return to the implementation test named by the note to see which
properties this repository actually verifies. Differences in compounding,
timing, discretization, loss sign, finite-sample convention, or calibration data
can change a result even when two implementations share a model name.
