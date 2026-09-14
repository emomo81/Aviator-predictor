# Disclaimer

Aviator and similar crash games are provably fair: each round's multiplier is the output of an
independent random number generator whose fairness can be verified after the fact (typically via a
pre-committed hash). Because rounds are independent, **no amount of history contains information about
the next round**, and no model — this one included — can predict it better than chance.

This repository is therefore **not** a tool for "beating" the game. It is a demonstration of:

1. Structured vision extraction (screenshot → JSON via Gemini).
2. Feature engineering from a time series of rounds.
3. A random-forest model trained and, crucially, *evaluated against a naive baseline* so you can see
   that on random data it finds nothing.

Using these numbers to place real bets would be relying on randomness the model does not and cannot
predict, and would lose money over time by the built-in house edge. Gambling carries serious risks. If
you choose to gamble, do so for entertainment only, with money you can afford to lose.
