/*
 * PhasePortrait: a simple square SVG plot for showing the 2-D trajectory
 * of a recurrent population's state under a complex-conjugate eigenpair.
 *
 * Used by §2's <RecurrentRefresher>. The trajectory points come in as
 * { x, y } in the same coordinate units as the view range (default ±1.6),
 * with index 0 being the initial state. Older points fade so the temporal
 * direction is legible without animation.
 */

import * as d3 from 'd3';

export interface PhasePortraitOptions {
  range?: number;
  dim?: number;
}

export class PhasePortrait {
  private xScale: d3.ScaleLinear<number, number>;
  private yScale: d3.ScaleLinear<number, number>;
  private root: d3.Selection<SVGGElement, unknown, null, undefined>;
  private trail: d3.Selection<SVGPathElement, unknown, null, undefined>;
  private dots: d3.Selection<SVGGElement, unknown, null, undefined>;
  private divergeWarning: d3.Selection<SVGTextElement, unknown, null, undefined>;

  constructor(svgEl: SVGSVGElement, opts: PhasePortraitOptions = {}) {
    const range = opts.range ?? 1.6;
    const dim = opts.dim ?? 300;
    const svg = d3.select(svgEl);
    svg
      .attr('viewBox', `0 0 ${dim} ${dim}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const margin = 24;
    const inner = dim - 2 * margin;
    this.xScale = d3.scaleLinear().domain([-range, range]).range([margin, margin + inner]);
    this.yScale = d3.scaleLinear().domain([-range, range]).range([margin + inner, margin]);

    this.root = svg.append('g').attr('class', 'phase-root');

    const grid = this.root.append('g').attr('class', 'phase-grid');
    const ticks = this.xScale.ticks(5);
    grid
      .selectAll('line.x')
      .data(ticks)
      .join('line')
      .attr('class', 'gridline')
      .attr('x1', (d) => this.xScale(d))
      .attr('x2', (d) => this.xScale(d))
      .attr('y1', this.yScale(-range))
      .attr('y2', this.yScale(range));
    grid
      .selectAll('line.y')
      .data(ticks)
      .join('line')
      .attr('class', 'gridline')
      .attr('x1', this.xScale(-range))
      .attr('x2', this.xScale(range))
      .attr('y1', (d) => this.yScale(d))
      .attr('y2', (d) => this.yScale(d));

    this.root
      .append('line')
      .attr('class', 'axis-line')
      .attr('x1', this.xScale(-range))
      .attr('x2', this.xScale(range))
      .attr('y1', this.yScale(0))
      .attr('y2', this.yScale(0))
      .attr('stroke', '#999');
    this.root
      .append('line')
      .attr('class', 'axis-line')
      .attr('x1', this.xScale(0))
      .attr('x2', this.xScale(0))
      .attr('y1', this.yScale(-range))
      .attr('y2', this.yScale(range))
      .attr('stroke', '#999');

    this.root
      .append('text')
      .attr('x', this.xScale(range) - 6)
      .attr('y', this.yScale(0) - 6)
      .attr('text-anchor', 'end')
      .attr('font-size', 14)
      .attr('fill', 'var(--text-muted)')
      .attr('font-family', 'var(--font-serif)')
      .attr('font-style', 'italic')
      .text('h₁');
    this.root
      .append('text')
      .attr('x', this.xScale(0) + 6)
      .attr('y', this.yScale(range) + 12)
      .attr('font-size', 14)
      .attr('fill', 'var(--text-muted)')
      .attr('font-family', 'var(--font-serif)')
      .attr('font-style', 'italic')
      .text('h₂');

    this.trail = this.root
      .append('path')
      .attr('class', 'phase-trail')
      .attr('fill', 'none')
      .attr('stroke', 'var(--accent-pole)')
      .attr('stroke-width', 1.8)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round');
    this.dots = this.root.append('g').attr('class', 'phase-dots');

    this.divergeWarning = this.root
      .append('text')
      .attr('x', dim - margin)
      .attr('y', margin + 10)
      .attr('text-anchor', 'end')
      .attr('font-size', 14)
      .attr('fill', 'var(--accent-pole)')
      .attr('font-family', 'var(--font-sans)')
      .attr('opacity', 0)
      .text('diverging — |λ| ≥ 1');
  }

  update(pts: readonly { x: number; y: number }[], diverging: boolean): void {
    const line = d3
      .line<{ x: number; y: number }>()
      .x((d) => this.xScale(d.x))
      .y((d) => this.yScale(d.y))
      .curve(d3.curveCatmullRom.alpha(0.5));

    const limit = 1.3 * this.xScale.domain()[1];
    const visible: { x: number; y: number; t: number }[] = [];
    for (let t = 0; t < pts.length; t++) {
      const p = pts[t];
      if (Math.hypot(p.x, p.y) > limit) break;
      visible.push({ x: p.x, y: p.y, t });
    }

    this.trail.attr('d', line(visible) ?? '');

    const total = pts.length;
    const dotJoin = this.dots
      .selectAll<SVGCircleElement, { x: number; y: number; t: number }>('circle')
      .data(visible, (d) => d.t);
    dotJoin.exit().remove();
    const dotEnter = dotJoin.enter().append('circle').attr('r', 3);
    dotEnter
      .merge(dotJoin)
      .attr('cx', (d) => this.xScale(d.x))
      .attr('cy', (d) => this.yScale(d.y))
      .attr('fill', (d) => (d.t === 0 ? 'var(--accent-active)' : 'var(--accent-pole)'))
      .attr('opacity', (d) => (d.t === 0 ? 1 : Math.max(0.15, 1 - d.t / total)));

    this.divergeWarning.attr('opacity', diverging ? 1 : 0);
  }
}
