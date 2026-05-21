# Dream Figures, Simulations, and Predictions

## A Complete Visual Programme for the Meromorphic Learning Dynamics Paper

---

## Part I — Pedagogical Figures

These figures assume the reader knows linear algebra and gradient descent but has never thought about poles, zeros, or the argument principle. Each one teaches a concept while simultaneously building toward the paper's results.

---

### Figure 1: What a Transfer Function Is

**Panel A:** A simple n=3 linear RNN processing white noise — show input, hidden states, output in the time domain.

**Panel B:** The power spectrum of the output, with sharp peaks.

**Panel C:** |H(e^{iθ})| evaluated on the unit circle — same peaks.

**Panel D:** The complex z-plane with poles as × and zeros as ○, the unit circle drawn through. The reader sees: where the unit circle passes near a pole, the output resonates. The entire input-output behavior is encoded by a finite set of marked points in ℂ.

---

### Figure 2: The Residue as a Volume Knob

Take a single pole at p = 0.95e^{iπ/4}.

**Panel A:** Residue r = 1: a sharp resonance peak in |H(e^{iθ})|.

**Panel B:** Residue r = 0 (a zero sits on the pole): the peak vanishes completely. The mode exists dynamically — the eigenvalue is still there — but it is invisible to the input-output map.

**Panel C:** Animate the zero pulling away from the pole: the peak grows continuously, proportional to |p − q|.

**Panel D:** The same animation shown as pole-zero motion in the z-plane.

This one figure teaches the core idea: pole-zero cancellation silences a mode, and separation activates it.

---

### Figure 3: The Argument Principle, Visually

**Panel A:** H(z) with 3 poles, 2 zeros. Draw a contour γ enclosing 2 poles, 1 zero. Map it forward: H(γ) winds once around the origin in the w-plane (winding number = 1 − 2 = −1).

**Panel B:** Now one pole inside γ has a zero on top of it. H(γ) doesn't wind (winding number = 1 − 1 = 0).

**Panel C:** Animate the zero sliding off the pole and across γ. The winding number jumps −1 → 0 at the exact instant of crossing — not gradually. It's an integer; it can't be 0.5.

**Panel D:** A small pedagogical diagram: the analogy to a light switch. Mode activation is digital even though parameters change smoothly.

---

### Figure 4: The Saddle, Directly

Minimal system: n = 2, one target pole.

**Panel A:** Plot the loss surface over the 2D subspace (α_k, β_k) — the observability and controllability coefficients. The surface has clear saddle geometry at α_k = 0.

**Panel B:** Hessian eigenvalues at the saddle: one positive, one negative.

**Panel C:** Gradient flow trajectories on this surface — they approach along the stable manifold, slow to a crawl at the saddle, then accelerate along the unstable manifold.

**Panel D:** The same trajectories mapped into the z-plane: the pole and zero sit together during the plateau, then separate during the escape. This figure visually proves the theorem.

---

## Part II — Core Theory Figures

---

### Figure 5: The Learning Staircase

The central figure. Train an n = 5 linear RNN on a target with 5 modes of decreasing spectral energy E₁ > E₂ > ... > E₅.

**Left tall panel:** Loss vs τ. Clear five-step staircase.

**Right tall panel:** Effective rank ρ(τ) as a step function 0→1→2→3→4→5, jumps aligned to loss drops.

**Bottom wide panel:** Six z-plane snapshots (initialization, four intermediate plateaus, convergence). At each snapshot, cancelled pairs are shown in gray, active pairs in color coded by frequency. Target poles shown as faint background stars. Small insets zoom into each separating pair at its transition moment, showing the direction of the zero's departure from the pole.

---

### Figure 6: Dwell Time Scaling

Tests Theorem 5.3 quantitatively.

**Panel A:** Measured dwell time T_ρ vs 1/E_eff(p*_{ρ+1}) across many target configurations. Theory predicts linear relationship. Show regression, R².

**Panel B:** Dwell time vs log(1/|ε₀|) at fixed spectral energy, varying initialization scale. Theory predicts linearity.

**Panel C:** Parity plot: measured dwell time vs the full theoretical formula T = (1/|λ|)log(ε_exit/|ε₀|). All points from all conditions on one plot against the identity line.

---

### Figure 7: Separation Direction and Spiral Transients

**Panel A:** Train on a single complex target pole. Track ε(τ) = p(τ) − q(τ) as a curve in ℂ. For a complex target pole, this curve is a spiral — the pole and zero orbit each other as they separate. For a real target pole, it's a straight line. Show both.

**Panel B:** Repeat for 8 different target phases arg(p*) evenly spaced around the circle. Show the initial separation direction in each case. Overlay the theoretical prediction from the cross-energy J_k.

**Panel C:** The output at the activated frequency during the transition. For complex poles: a transient overshoot (amplitude exceeds final value then relaxes). For real poles: monotonic growth.

**Panel D:** Measure transient oscillation frequency and growth rate, plot against predictions |λ|sin(φ/2) and |λ|cos(φ/2).

---

## Part III — Nontrivial Predictions

---

### Figure 8: Topological Protection

**Panel A:** After converging all 5 modes, perturb parameters with Gaussian noise of increasing variance σ². For each noise level, check which modes survive (|r_k| above threshold). Plot survival probability vs σ² for each mode — five curves, ordered by robustness.

**Panel B:** The theory says the critical noise for killing mode k scales with |p_k − q_k|². Plot measured critical σ² vs pole-zero separation squared. Should be linear.

**Panel C:** Robustness rank vs learning order — perfectly anticorrelated. Early-learned modes (largest spectral energy, largest final separation) die last.

---

### Figure 9: Catastrophic Interference

The killer figure. n = 4 network, Task A has two modes, Task B has two modes.

**Panel A (large):** z-plane showing all pole and zero *trajectories* during Task B training as curves in ℂ. Color Task A modes blue, Task B modes red. At a specific τ, a free zero (red, mobilized by Task B's gradient) collides with a Task A pole (blue). Highlight the collision in yellow.

**Panel B:** Task A loss vs Task B training time. The sharp degradation aligns precisely with the collision time from Panel A. Mark it with a vertical line.

**Panel C:** Scatter plot across 50 random seeds: predicted collision time (from zero trajectory geometry) vs measured time of Task A collapse. Should cluster on the diagonal.

**Panel D:** The spectral overlap experiment: vary the angle between Task A and Task B poles. Plot Task A retention vs angular distance. Theory predicts a sharp threshold — modes are protected when Task B needs the same frequency, forgotten when it doesn't. Show predicted threshold curve and data.

---

### Figure 10: Why Eigenvalues Are Not Enough

**Panel A:** Construct two RNNs with identical W (same eigenvalues) but different (b, c). One has all modes active, the other has two cancelled. Their transfer functions are completely different.

**Panel B:** Train both on the same target. Completely different learning trajectories despite identical initial eigenvalue spectra.

**Panel C (three rows):**
- Top row: eigenvalues of W vs τ (smooth, uninformative).
- Middle row: loss vs τ (staircase).
- Bottom row: pole-zero separations vs τ (staircases aligned with loss).

The middle correlates with the bottom, not the top. This directly argues that eigenvalue analysis misses the mechanism, and the residue (which requires the full W, B, C structure) is the correct order parameter.

---

### Figure 11: The Activation Hypercube

A theoretical figure, no simulation.

**Panel A:** For n = 3, the activation index a ∈ {0,1}³ lives on vertices of a 3-cube. Draw it. Each vertex is a saddle. Edges connect saddles that differ by one mode activation.

**Panel B:** The Saxe-like learning trajectory is a path along edges: 000 → 100 → 110 → 111 (activating the highest-energy mode first). But the cube has other paths (e.g., 000 → 010 → 011 → 111). Show that the spectral-energy-ordered path has shortest total dwell time.

**Panel C:** Catastrophic interference corresponds to *backward* steps: 111 → 101. The cube naturally accommodates both forward (activation) and backward (deactivation) transitions. The feedforward SVD theory only sees forward paths; the meromorphic theory sees the whole graph.

---

## Part IV — Extensions and Scaling

---

### Figure 12: Nonlinear Coherent Separation

**Panel A:** Train a tanh RNN (n = 10) and a linear RNN (n = 10) on the same multi-frequency target. Overlay loss curves. Both show staircases, but the nonlinear network has longer plateaus.

**Panel B:** For the nonlinear network at each training step, compute instantaneous poles and zeros at K = 100 random operating points. Plot the *distribution* of pole-zero separations across operating points as a violin plot evolving over training time. At a plateau, the distribution is concentrated near zero. During a transition, it broadens — some operating points separate first, others lag.

**Panel C:** The theory predicts the escape rate is controlled by the worst-case operating point. Plot measured escape rate vs mean escape rate and vs minimum escape rate across operating points. The minimum should be the better predictor.

**Panel D:** Ratio of nonlinear dwell time to linear dwell time vs a measure of operating-point heterogeneity (variance of instantaneous pole-zero separation). Should increase monotonically.

---

### Figure 13: Scaling to Large Networks

**Panel A:** Loss staircases for n = 5, 10, 20, 50, 100, all on targets with geometrically decreasing spectral energies. Staircase structure persists at all sizes.

**Panel B:** Rescale time by E_max. The curves collapse to a universal shape.

**Panel C:** For n = 100, individual pole-zero tracking is unreadable. Instead show a histogram of all pole-zero separations at several training snapshots. The histogram evolves from unimodal (all near zero) to bimodal (a cluster at zero + a cluster at finite separation) to fully separated.

**Panel D:** Cumulative effective rank ρ(τ)/n vs normalized time for all network sizes. Universal sigmoid collapse.

---

## Part V — Data-Dependent Predictions (New)

These figures address the generalization from white-noise to structured-input training.

---

### Figure 14: Input-Dependent Mode Ordering

**Panel A:** Target has 4 modes with equal target spectral energy but at different frequencies. Train with a structured input whose PSD is a bandpass filter centered on one of the frequencies. The mode at the input's peak frequency is learned first, despite all modes having equal target energy. Repeat for 4 different bandpass centers — the first-activated mode always matches the input peak.

**Panel B:** Plot activation order vs E_eff = E_target · S_x for all 16 mode×condition combinations. Perfect rank correlation.

**Panel C:** Contrast with white-noise training on the same target: all four modes activate nearly simultaneously (equal E_target, equal S_x). This is the control showing that ordering differences in Panel A are genuinely input-driven.

---

### Figure 15: Separation Direction Depends on Input Phase

**Panel A:** Fix a complex target pole. Train with two different structured inputs that have the same power spectrum but different phase spectra at the target pole's frequency. The separation direction ε(τ) in ℂ differs between the two conditions, even though the escape rate is similar.

**Panel B:** Overlay the measured separation direction (angle of ε at a fixed |ε|) against the predicted direction arg(λ)/2, computed from the cross-energy J_k under each input distribution. The data-dependent theory (Corollary 5.2) should match; the white-noise prediction (which ignores input phase) should not.

**Panel C:** Consequence for generalization: after training with structured input, evaluate on a novel input with different phase. The output's transient at the mode frequency has a phase offset predicted by the difference between training and test separation directions.

---

### Figure 16: Finite-Sequence Corrections

**Panel A:** Fix a pole at |p| = 0.99 (memory ≈ 100 steps). Train with sequence lengths T = 50, 100, 200, 500, 1000. Plot dwell time vs T. The theory (Proposition 7.3) predicts a correction factor (1 + O(|p|^T)) — an exponential convergence to the infinite-T value.

**Panel B:** Same experiment but for a pole at |p| = 0.9 (memory ≈ 10 steps). The correction is negligible for all T > 50.

**Panel C:** The danger zone: plot the region in (|p|, T) space where the finite-sequence correction exceeds 10%. This is the parameter regime where the pole-zero framework becomes only qualitatively correct.

---

## Simulation Architecture

All core simulations share a base system:

- **System:** h_t = Wh_{t-1} + bx_t, y_t = cᵀh_t (linear) or h_t = tanh(Wh_{t-1} + bx_t) (nonlinear). Scalar I/O.
- **Loss:** Time-domain MSE under the specified data distribution, $\frac{1}{NT}\sum_{i,t}(y_t - \hat{y}_t)^2$.
- **Optimizer:** Pure gradient flow, Euler-discretized with small step size. Critically, *not* Adam or SGD with momentum — the theory assumes gradient flow and adaptive methods introduce confounds.
- **Measurements per step:** poles (eigenvalues of W), zeros (roots of numerator polynomial via companion matrix or generalized eigenvalue problem on the Rosenbrock pencil), residues (cᵀv_k · u_k*b), pole-zero separations, effective rank, winding numbers (numerically evaluated contour integrals).
- **Input distributions:** White noise (baseline), bandpass-filtered noise (Figure 14), phase-structured noise (Figure 15), natural signals (extension).
- **Initialization:** Small-norm Gaussian for all parameters, with σ_init as a controllable variable.
- **Repeats:** 50 seeds per condition for all statistical analyses.

---

## What Would Be Genuinely Surprising

Beyond confirming the theory, five results would elevate this substantially:

**S1: Stochastic robustness.** The staircase and spectral ordering survive under SGD with minibatching and realistic noise. The topological invariant (integer winding number) may act as a natural noise filter — you can't stochastically "half-activate" a mode.

**S2: Nonlinear transfer.** Zero-trajectory predictions of forgetting events transfer accurately to nonlinear RNNs. The linearized theory working far beyond its strict domain of validity would be a strong statement.

**S3: State-space models.** The framework applies to state-space models (S4, Mamba, linear attention), which have explicit linear recurrences. Verifying spectral ordering in these architectures connects the theory to models people actually train at scale.

**S4: Generalization geometry.** The separation phase φ predicts generalization quality, not just training loss. Modes that separate along the "correct" phase in ℂ generalize; modes that separate along a rotated direction overfit. This would give the complex geometry functional consequences beyond optimization.

**S5: Biological signatures.** Linearized dynamics extracted from multi-electrode recordings during animal motor learning show the predicted signatures — sequential mode activation at plateaus, pole-zero coincidence, spectral ordering. The predictions are precise enough to test against real neural data.

---

## Narrative Arc

Start with what the complex plane is and why the reader should care. Build to the staircase, which is visually stunning and quantitatively exact. Then show that the complex-plane geometry makes predictions that no other framework can — about the direction of learning, about topological robustness, about when and which modes will be catastrophically forgotten. Introduce the data-dependent predictions as the payoff of generalizing beyond white noise. End by showing the theory scales and transfers to the nonlinear and biological settings that actually matter.
