/*
 * ContourFlow: a 2-D loss-landscape view with a canvas heatmap, an SVG
 * contour overlay, optional axis overlays (e.g. the stable/unstable
 * diagonals of a saddle), an arbitrary number of pre-baked trajectory
 * curves, and an animating "live ball" trajectory the host widget drives
 * frame by frame.
 *
 * The host owns timing (RAF loop, integration step) and just feeds in
 * the updated trajectory and current point each frame.
 */

import * as d3 from 'd3';

export interface ContourFlowOptions {
  width?: number;
  height?: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Loss function over the visible window. */
  loss: (x: number, y: number) => number;
  /** Heatmap resolution (cells per side). Default 160. */
  resolution?: number;
  /** Number of level curves. Default 18. */
  nContours?: number;
  /**
   * Symmetric colour-domain cap. Pass when the loss can take values whose
   * full range is much larger than the interesting range (so the colormap
   * isn't washed out). Defaults to the actual min/max on the sampled grid.
   */
  colorDomain?: [number, number];
  /** Override the diverging colormap. Default: d3.interpolateRdBu reversed. */
  colorInterpolator?: (t: number) => string;
  /** Click in data coordinates; called only if onClick is provided. */
  onClick?: (x: number, y: number) => void;
  /** Axis labels for the figure. */
  xLabel?: string;
  yLabel?: string;
}

export interface ContourFlowAxis {
  id: string;
  /** Unit-vector direction (will be drawn through the origin to the bounding box). */
  dx: number;
  dy: number;
  label?: string;
  /** Pass 'stable' for a cool grey, 'unstable' for the warm pole accent. */
  kind?: 'stable' | 'unstable';
}

export interface ContourFlowTrace {
  id: string;
  points: { x: number; y: number }[];
  color?: string;
  width?: number;
  opacity?: number;
  dash?: string;
}

export interface ContourFlowPoint {
  x: number;
  y: number;
  color?: string;
  radius?: number;
  label?: string;
}

export class ContourFlow {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: Required<Omit<ContourFlowOptions, 'colorDomain' | 'onClick' | 'xLabel' | 'yLabel'>>
    & Pick<ContourFlowOptions, 'colorDomain' | 'onClick' | 'xLabel' | 'yLabel'>;
  private width: number;
  private height: number;
  private margin = { top: 16, right: 16, bottom: 42, left: 48 };
  private xScale: d3.ScaleLinear<number, number>;
  private yScale: d3.ScaleLinear<number, number>;
  private root: d3.Selection<SVGGElement, unknown, null, undefined>;
  private axesG: d3.Selection<SVGGElement, unknown, null, undefined>;
  private contoursG: d3.Selection<SVGGElement, unknown, null, undefined>;
  private overlayAxesG: d3.Selection<SVGGElement, unknown, null, undefined>;
  private bakedTracesG: d3.Selection<SVGGElement, unknown, null, undefined>;
  private liveTraceG: d3.Selection<SVGGElement, unknown, null, undefined>;
  private liveBallG: d3.Selection<SVGGElement, unknown, null, undefined>;
  private clickRect!: d3.Selection<SVGRectElement, unknown, null, undefined>;
  private innerLeft = 0;
  private innerTop = 0;
  private innerW = 0;
  private innerH = 0;

  constructor(
    svgEl: SVGSVGElement,
    canvasEl: HTMLCanvasElement,
    opts: ContourFlowOptions,
  ) {
    this.svg = d3.select(svgEl);
    this.canvas = canvasEl;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) throw new Error('ContourFlow: canvas 2d context unavailable');
    this.ctx = ctx;

    this.opts = {
      width: opts.width ?? 340,
      height: opts.height ?? 340,
      xMin: opts.xMin,
      xMax: opts.xMax,
      yMin: opts.yMin,
      yMax: opts.yMax,
      loss: opts.loss,
      resolution: opts.resolution ?? 160,
      nContours: opts.nContours ?? 18,
      colorInterpolator: opts.colorInterpolator ?? ((t: number) => d3.interpolateRdBu(1 - t)),
      colorDomain: opts.colorDomain,
      onClick: opts.onClick,
      xLabel: opts.xLabel,
      yLabel: opts.yLabel,
    };

    this.width = this.opts.width;
    this.height = this.opts.height;
    const m = this.margin;
    this.innerLeft = m.left;
    this.innerTop = m.top;
    this.innerW = this.width - m.left - m.right;
    this.innerH = this.height - m.top - m.bottom;

    this.xScale = d3.scaleLinear()
      .domain([this.opts.xMin, this.opts.xMax])
      .range([m.left, this.width - m.right]);
    this.yScale = d3.scaleLinear()
      .domain([this.opts.yMin, this.opts.yMax])
      .range([this.height - m.bottom, m.top]);

    this.svg
      .attr('viewBox', `0 0 ${this.width} ${this.height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    this.root = this.svg.append('g').attr('class', 'contour-flow-root');
    this.contoursG = this.root.append('g').attr('class', 'cf-contours');
    this.overlayAxesG = this.root.append('g').attr('class', 'cf-overlay-axes');
    this.bakedTracesG = this.root.append('g').attr('class', 'cf-baked-traces');
    this.liveTraceG = this.root.append('g').attr('class', 'cf-live-trace');
    this.liveBallG = this.root.append('g').attr('class', 'cf-live-ball');
    this.axesG = this.root.append('g').attr('class', 'cf-axes');

    this.canvas.style.position = 'absolute';
    this.canvas.style.left = '0';
    this.canvas.style.top = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';

    this.drawStaticAxes();
    this.drawClickTarget();
    this.renderHeatmapAndContours();
  }

  // ───────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────

  /** Update loss function and re-render heatmap + contours. */
  setLoss(loss: (x: number, y: number) => number, colorDomain?: [number, number]): void {
    this.opts.loss = loss;
    if (colorDomain) this.opts.colorDomain = colorDomain;
    this.renderHeatmapAndContours();
  }

  setOverlayAxes(axes: ContourFlowAxis[]): void {
    const xc = this.xScale(0);
    const yc = this.yScale(0);

    // Clip a line through (0,0) in direction (dx, dy) to the inner plot box.
    const clip = (dx: number, dy: number): {x1: number; y1: number; x2: number; y2: number} => {
      // Convert direction to pixel-direction (note y is flipped).
      const pdx = dx * (this.xScale(1) - this.xScale(0));
      const pdy = dy * (this.yScale(1) - this.yScale(0));
      const len = Math.hypot(pdx, pdy) || 1;
      const ux = pdx / len;
      const uy = pdy / len;
      // Parametrize p(t) = (xc, yc) + t (ux, uy); find t at each bounding edge.
      const ts: number[] = [];
      if (Math.abs(ux) > 1e-9) {
        ts.push((this.innerLeft - xc) / ux);
        ts.push((this.innerLeft + this.innerW - xc) / ux);
      }
      if (Math.abs(uy) > 1e-9) {
        ts.push((this.innerTop - yc) / uy);
        ts.push((this.innerTop + this.innerH - yc) / uy);
      }
      // Keep only ts that land inside the box.
      const insideTs = ts.filter((t) => {
        const px = xc + t * ux;
        const py = yc + t * uy;
        return (
          px >= this.innerLeft - 1e-3 && px <= this.innerLeft + this.innerW + 1e-3 &&
          py >= this.innerTop - 1e-3 && py <= this.innerTop + this.innerH + 1e-3
        );
      });
      if (insideTs.length < 2) return { x1: xc, y1: yc, x2: xc, y2: yc };
      const tMin = Math.min(...insideTs);
      const tMax = Math.max(...insideTs);
      return {
        x1: xc + tMin * ux,
        y1: yc + tMin * uy,
        x2: xc + tMax * ux,
        y2: yc + tMax * uy,
      };
    };

    const sel = this.overlayAxesG
      .selectAll<SVGGElement, ContourFlowAxis>('g.overlay-axis')
      .data(axes, (d) => d.id);
    sel.exit().remove();
    const enter = sel.enter().append('g').attr('class', 'overlay-axis');
    enter.append('line').attr('class', 'overlay-axis-line');
    enter.append('text').attr('class', 'overlay-axis-label');
    const all = enter.merge(sel);
    all.each((d, i, nodes) => {
      const g = d3.select(nodes[i]);
      const seg = clip(d.dx, d.dy);
      const stroke = d.kind === 'unstable' ? 'var(--accent-pole)' : 'var(--text-muted)';
      g.select<SVGLineElement>('line')
        .attr('x1', seg.x1).attr('y1', seg.y1)
        .attr('x2', seg.x2).attr('y2', seg.y2)
        .attr('stroke', stroke)
        .attr('stroke-width', 1.4)
        .attr('stroke-dasharray', '5 4')
        .attr('opacity', 0.78);
      const label = d.label;
      const txt = g.select<SVGTextElement>('text');
      if (label) {
        // Place label near the (x2, y2) end with a small inward offset.
        const lenX = seg.x2 - seg.x1;
        const lenY = seg.y2 - seg.y1;
        const L = Math.hypot(lenX, lenY) || 1;
        const inset = 46;
        const lx = seg.x2 - (lenX / L) * inset;
        const ly = seg.y2 - (lenY / L) * inset;
        txt.attr('x', lx).attr('y', ly).text(label)
          .attr('fill', stroke)
          .attr('font-family', "'Inter', sans-serif")
          .attr('font-size', 15)
          .attr('font-weight', 500)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('opacity', 0.95);
      } else {
        txt.text('');
      }
    });
  }

  /** Pre-baked, immutable trajectory curves (drawn faint, under the live ball). */
  setBakedTraces(traces: ContourFlowTrace[]): void {
    const lineGen = d3.line<{ x: number; y: number }>()
      .x((d) => this.xScale(d.x))
      .y((d) => this.yScale(d.y));
    const sel = this.bakedTracesG
      .selectAll<SVGPathElement, ContourFlowTrace>('path')
      .data(traces, (d) => d.id);
    sel.exit().remove();
    const merged = sel.enter().append('path').merge(sel);
    merged
      .attr('d', (d) => lineGen(d.points) ?? '')
      .attr('fill', 'none')
      .attr('stroke', (d) => d.color ?? 'var(--text-soft)')
      .attr('stroke-width', (d) => d.width ?? 1.25)
      .attr('stroke-dasharray', (d) => d.dash ?? null)
      .attr('opacity', (d) => d.opacity ?? 0.45);
  }

  /** The live ball's trajectory so far. */
  setLiveTrace(points: { x: number; y: number }[], color = 'var(--accent-pole)'): void {
    const lineGen = d3.line<{ x: number; y: number }>()
      .x((d) => this.xScale(d.x))
      .y((d) => this.yScale(d.y));
    const sel = this.liveTraceG
      .selectAll<SVGPathElement, number>('path')
      .data([0]);
    const merged = sel.enter().append('path').merge(sel);
    merged
      .attr('d', lineGen(points) ?? '')
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2.2)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round');
  }

  /** The current head of the live trajectory: a small disk. */
  setLiveBall(p: ContourFlowPoint | null): void {
    const data = p ? [p] : [];
    const sel = this.liveBallG
      .selectAll<SVGCircleElement, ContourFlowPoint>('circle')
      .data(data, () => 'ball');
    sel.exit().remove();
    const enter = sel.enter().append('circle');
    enter.merge(sel)
      .attr('cx', (d) => this.xScale(d.x))
      .attr('cy', (d) => this.yScale(d.y))
      .attr('r', (d) => d.radius ?? 5)
      .attr('fill', (d) => d.color ?? 'var(--accent-pole)')
      .attr('stroke', 'var(--bg-elevated)')
      .attr('stroke-width', 1.6);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────

  private drawStaticAxes(): void {
    const m = this.margin;
    const x = this.xScale;
    const y = this.yScale;

    // Coordinate axes through the origin (since the saddle is at (0,0)).
    this.axesG.append('line')
      .attr('class', 'cf-axis-line')
      .attr('x1', x(this.opts.xMin)).attr('x2', x(this.opts.xMax))
      .attr('y1', y(0)).attr('y2', y(0))
      .attr('stroke', 'var(--text-muted)').attr('stroke-width', 0.8).attr('opacity', 0.6);
    this.axesG.append('line')
      .attr('class', 'cf-axis-line')
      .attr('x1', x(0)).attr('x2', x(0))
      .attr('y1', y(this.opts.yMin)).attr('y2', y(this.opts.yMax))
      .attr('stroke', 'var(--text-muted)').attr('stroke-width', 0.8).attr('opacity', 0.6);

    // Bounding box.
    this.axesG.append('rect')
      .attr('x', m.left).attr('y', m.top)
      .attr('width', this.innerW).attr('height', this.innerH)
      .attr('fill', 'none').attr('stroke', 'var(--rule-strong)').attr('stroke-width', 1);

    // Tick axes.
    const xAxis = d3.axisBottom(x).ticks(5).tickSizeOuter(0);
    const yAxis = d3.axisLeft(y).ticks(5).tickSizeOuter(0);
    this.axesG.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0, ${this.height - m.bottom})`)
      .call(xAxis);
    this.axesG.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${m.left}, 0)`)
      .call(yAxis);

    if (this.opts.xLabel) {
      this.axesG.append('text')
        .attr('x', (this.width - m.right + m.left) / 2)
        .attr('y', this.height - 8)
        .attr('text-anchor', 'middle')
        .attr('font-family', "'Inter', sans-serif")
        .attr('font-size', 15)
        .attr('font-style', 'italic')
        .attr('fill', 'var(--text-muted)')
        .text(this.opts.xLabel);
    }
    if (this.opts.yLabel) {
      this.axesG.append('text')
        .attr('transform', `translate(15, ${(this.height - m.bottom + m.top) / 2}) rotate(-90)`)
        .attr('text-anchor', 'middle')
        .attr('font-family', "'Inter', sans-serif")
        .attr('font-size', 15)
        .attr('font-style', 'italic')
        .attr('fill', 'var(--text-muted)')
        .text(this.opts.yLabel);
    }
  }

  private drawClickTarget(): void {
    // Transparent rect on top to capture clicks (the canvas is non-interactive).
    const m = this.margin;
    this.clickRect = this.root.append('rect')
      .attr('class', 'cf-click-target')
      .attr('x', m.left).attr('y', m.top)
      .attr('width', this.innerW).attr('height', this.innerH)
      .attr('fill', 'transparent')
      .style('cursor', this.opts.onClick ? 'crosshair' : 'default');
    if (this.opts.onClick) {
      const onClick = this.opts.onClick;
      this.clickRect.on('click', (event: MouseEvent) => {
        const [px, py] = d3.pointer(event, this.root.node());
        const x = this.xScale.invert(px);
        const y = this.yScale.invert(py);
        onClick(x, y);
      });
    }
    // Always keep the click target above the trajectory layers so it actually receives events.
    this.clickRect.raise();
  }

  private renderHeatmapAndContours(): void {
    const res = this.opts.resolution;
    const N = res;
    const values = new Float64Array(N * N);
    // d3.contours expects values laid out row-major with y increasing downward
    // in *pixel* coordinates, so we flip the y indexing to match (rendering on
    // canvas this way means row 0 corresponds to the top edge / max y).
    let vMin = Infinity;
    let vMax = -Infinity;
    for (let j = 0; j < N; j++) {
      const y = this.opts.yMax - (this.opts.yMax - this.opts.yMin) * (j / (N - 1));
      for (let i = 0; i < N; i++) {
        const x = this.opts.xMin + (this.opts.xMax - this.opts.xMin) * (i / (N - 1));
        const v = this.opts.loss(x, y);
        values[j * N + i] = v;
        if (v < vMin) vMin = v;
        if (v > vMax) vMax = v;
      }
    }
    const [domLo, domHi] = this.opts.colorDomain ?? [vMin, vMax];
    // Build a sequential colour scale and paint the canvas.
    const color = d3.scaleSequential((t) => this.opts.colorInterpolator(t))
      .domain([domLo, domHi])
      .clamp(true);

    // Paint canvas at native pixel resolution then let CSS stretch to fit.
    const cw = N;
    const ch = N;
    this.canvas.width = cw;
    this.canvas.height = ch;
    const img = this.ctx.createImageData(cw, ch);
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        const v = values[j * N + i];
        const rgb = d3.rgb(color(v));
        const idx = 4 * (j * cw + i);
        img.data[idx + 0] = rgb.r;
        img.data[idx + 1] = rgb.g;
        img.data[idx + 2] = rgb.b;
        img.data[idx + 3] = 215; // gentle translucency so trajectories pop on top
      }
    }
    this.ctx.putImageData(img, 0, 0);

    // Stretch canvas to match the inner plot box.
    this.canvas.style.left = `${(this.innerLeft / this.width) * 100}%`;
    this.canvas.style.top = `${(this.innerTop / this.height) * 100}%`;
    this.canvas.style.width = `${(this.innerW / this.width) * 100}%`;
    this.canvas.style.height = `${(this.innerH / this.height) * 100}%`;

    // Contours: choose level set, e.g. equally spaced between dom min/max.
    // Use d3.contours to produce paths in grid coords, then map to inner plot box.
    const nLevels = this.opts.nContours;
    const thresholds: number[] = [];
    for (let k = 1; k < nLevels; k++) {
      thresholds.push(domLo + (k / nLevels) * (domHi - domLo));
    }
    const contourGen = d3.contours().size([N, N]).thresholds(thresholds);
    const polys = contourGen(values as unknown as number[]);

    const sx = this.innerW / (N - 1);
    const sy = this.innerH / (N - 1);
    const x0 = this.innerLeft;
    const y0 = this.innerTop;
    const path = d3.geoPath<d3.GeoPermissibleObjects>(
      // Transform: gridpoint (i, j) ↦ canvas pixel (x0 + i·sx, y0 + j·sy).
      // We use a custom projector through geoTransform.
      d3.geoTransform({
        point(x: number, y: number) {
          (this as unknown as { stream: { point: (x: number, y: number) => void } }).stream.point(
            x0 + x * sx,
            y0 + y * sy,
          );
        },
      }) as unknown as d3.GeoStreamWrapper & d3.GeoProjection,
    );

    const join = this.contoursG
      .selectAll<SVGPathElement, d3.ContourMultiPolygon>('path.cf-contour')
      .data(polys);
    join.exit().remove();
    const enter = join.enter().append('path').attr('class', 'cf-contour');
    enter.merge(join)
      .attr('d', (d) => path(d) ?? '')
      .attr('fill', 'none')
      .attr('stroke', 'var(--text)')
      .attr('stroke-width', 0.55)
      .attr('opacity', (d) => {
        // Emphasise the contour closest to zero (the saddle's pinch).
        const closeness = 1 - Math.min(1, Math.abs(d.value) / Math.max(Math.abs(domHi), Math.abs(domLo)));
        return 0.18 + 0.32 * closeness;
      });
  }
}
