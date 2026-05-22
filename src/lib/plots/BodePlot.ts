/*
 * BodePlot: magnitude of the frequency response |H(e^{i theta})| as theta
 * sweeps [0, pi]. Optional second curve for a target (ghost) system, optional
 * phase axis (off by default — the comp-neuro audience cares about magnitude
 * peaks first).
 *
 * Convention: theta in [0, pi] only, since |H(e^{-i theta})| = |H(e^{i theta})|
 * for real-coefficient systems. The x axis is in units of pi.
 */

import * as d3 from 'd3';

export interface BodeData {
  theta: number[];   // [0, pi]
  magnitude: number[];
}

export interface BodePlotOptions {
  width?: number;
  height?: number;
  yMin?: number;
  yMax?: number;
  yLog?: boolean;     // default true
  showGrid?: boolean; // default true
}

export class BodePlot {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private opts: Required<BodePlotOptions>;
  private width = 0;
  private height = 0;
  private margin = { top: 16, right: 16, bottom: 42, left: 52 };
  private xScale!: d3.ScaleLinear<number, number>;
  private yScale!: d3.ScaleContinuousNumeric<number, number>;
  private root!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private mainPath!: d3.Selection<SVGPathElement, unknown, null, undefined>;
  private ghostPath!: d3.Selection<SVGPathElement, unknown, null, undefined>;

  constructor(svgEl: SVGSVGElement, opts: BodePlotOptions = {}) {
    this.svg = d3.select(svgEl);
    this.opts = {
      width: opts.width ?? 0,
      height: opts.height ?? 0,
      yMin: opts.yMin ?? 0.01,
      yMax: opts.yMax ?? 100,
      yLog: opts.yLog ?? true,
      showGrid: opts.showGrid ?? true,
    };
    this.initLayout();
    this.drawStatic();
  }

  private initLayout(): void {
    // Fixed internal coordinate system. Keep it near the real rendered size
    // (~300px) so axis labels aren't downscaled into illegibility.
    this.width = this.opts.width || 320;
    this.height = this.opts.height || 200;
    this.svg
      .attr('viewBox', `0 0 ${this.width} ${this.height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const m = this.margin;
    this.xScale = d3
      .scaleLinear()
      .domain([0, Math.PI])
      .range([m.left, this.width - m.right]);
    this.yScale = (this.opts.yLog
      ? d3.scaleLog().domain([this.opts.yMin, this.opts.yMax])
      : d3.scaleLinear().domain([this.opts.yMin, this.opts.yMax])
    ).range([this.height - m.bottom, m.top]) as d3.ScaleContinuousNumeric<number, number>;
    this.root = this.svg.append('g').attr('class', 'bode-root');
  }

  private drawStatic(): void {
    const { root, xScale, yScale, width, height, margin: m } = this;

    if (this.opts.showGrid) {
      // y gridlines (decade lines for log scale).
      const yTicks = (yScale as any).ticks
        ? (yScale as any).ticks(this.opts.yLog ? 4 : 5)
        : [];
      root
        .selectAll('line.y-grid')
        .data(yTicks as number[])
        .join('line')
        .attr('class', 'gridline')
        .attr('x1', m.left)
        .attr('x2', width - m.right)
        .attr('y1', (d) => yScale(d))
        .attr('y2', (d) => yScale(d));
    }

    // X axis with ticks labeled in units of pi.
    const xAxis = d3
      .axisBottom(xScale)
      .tickValues([0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI])
      .tickFormat((d) => {
        const v = d as number;
        if (Math.abs(v) < 1e-9) return '0';
        if (Math.abs(v - Math.PI) < 1e-9) return 'π';
        if (Math.abs(v - Math.PI / 2) < 1e-9) return 'π/2';
        if (Math.abs(v - Math.PI / 4) < 1e-9) return 'π/4';
        if (Math.abs(v - (3 * Math.PI) / 4) < 1e-9) return '3π/4';
        return `${v.toFixed(2)}`;
      });
    root
      .append('g')
      .attr('class', 'axis x-axis')
      .attr('transform', `translate(0, ${height - m.bottom})`)
      .call(xAxis);

    const yAxis = (d3.axisLeft(yScale) as any).ticks(5, this.opts.yLog ? '.1g' : undefined);
    root
      .append('g')
      .attr('class', 'axis y-axis')
      .attr('transform', `translate(${m.left}, 0)`)
      .call(yAxis);

    // Axis labels.
    root
      .append('text')
      .attr('x', (width - m.right + m.left) / 2)
      .attr('y', height - 8)
      .attr('text-anchor', 'middle')
      .attr('font-size', 15)
      .attr('fill', '#555')
      .text('frequency θ (rad/step)');

    root
      .append('text')
      .attr('transform', `translate(15, ${(height - m.bottom + m.top) / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .attr('font-size', 15)
      .attr('fill', '#555')
      .text('|H(e^{iθ})|');

    // Paths for ghost and main curves (ghost drawn first → underneath).
    this.ghostPath = root
      .append('path')
      .attr('class', 'bode-ghost')
      .attr('fill', 'none')
      .attr('stroke', 'var(--accent-target)')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4 3')
      .attr('opacity', 0.8);
    this.mainPath = root
      .append('path')
      .attr('class', 'bode-main')
      .attr('fill', 'none')
      .attr('stroke', 'var(--accent-active)')
      .attr('stroke-width', 2);
  }

  update(data: BodeData, ghost?: BodeData): void {
    const { xScale, yScale } = this;
    const allowZero = !this.opts.yLog;
    const line = d3
      .line<{ theta: number; mag: number }>()
      .x((d) => xScale(d.theta))
      .y((d) => yScale(Math.max(this.opts.yMin, d.mag)))
      .defined((d) => Number.isFinite(d.mag) && (allowZero ? d.mag >= 0 : d.mag > 0));
    const main = data.theta.map((t, i) => ({ theta: t, mag: data.magnitude[i] }));
    this.mainPath.attr('d', line(main) ?? '');
    if (ghost) {
      const g = ghost.theta.map((t, i) => ({ theta: t, mag: ghost.magnitude[i] }));
      this.ghostPath.attr('d', line(g) ?? '').style('display', null);
    } else {
      this.ghostPath.style('display', 'none');
    }
  }
}
