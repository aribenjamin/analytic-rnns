/*
 * TimeSeries: a simple line / stem plot for impulse responses, training loss
 * curves, etc. Supports multiple traces with custom colors and optional
 * baseline-zero (stem) styling.
 */

import * as d3 from 'd3';

export interface TimeSeriesTrace {
  id: string;
  values: number[];
  color?: string;
  style?: 'line' | 'stem';
  width?: number;
  dasharray?: string;
}

export interface TimeSeriesOptions {
  width?: number;
  height?: number;
  yMin?: number;
  yMax?: number;
  xLabel?: string;
  yLabel?: string;
  yLog?: boolean;
}

export class TimeSeries {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private opts: TimeSeriesOptions;
  private width = 0;
  private height = 0;
  private margin = { top: 16, right: 14, bottom: 42, left: 64 };
  private xScale!: d3.ScaleLinear<number, number>;
  private yScale!: d3.ScaleContinuousNumeric<number, number>;
  private root!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private xAxisG!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private yAxisG!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private linesG!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private xLabelEl!: d3.Selection<SVGTextElement, unknown, null, undefined>;
  private yLabelEl!: d3.Selection<SVGTextElement, unknown, null, undefined>;

  constructor(svgEl: SVGSVGElement, opts: TimeSeriesOptions = {}) {
    this.svg = d3.select(svgEl);
    this.opts = opts;
    this.initLayout();
  }

  private initLayout(): void {
    // Fixed internal coordinate system; CSS handles external sizing.
    this.width = this.opts.width ?? 340;
    this.height = this.opts.height ?? 230;
    this.svg
      .attr('viewBox', `0 0 ${this.width} ${this.height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const m = this.margin;
    this.xScale = d3.scaleLinear().range([m.left, this.width - m.right]);
    this.yScale = (this.opts.yLog
      ? d3.scaleLog()
      : d3.scaleLinear()
    ).range([this.height - m.bottom, m.top]) as d3.ScaleContinuousNumeric<number, number>;

    this.root = this.svg.append('g').attr('class', 'timeseries-root');
    this.xAxisG = this.root
      .append('g')
      .attr('class', 'axis x-axis')
      .attr('transform', `translate(0, ${this.height - m.bottom})`);
    this.yAxisG = this.root
      .append('g')
      .attr('class', 'axis y-axis')
      .attr('transform', `translate(${m.left}, 0)`);

    this.xLabelEl = this.root
      .append('text')
      .attr('x', (this.width - m.right + m.left) / 2)
      .attr('y', this.height - 8)
      .attr('text-anchor', 'middle')
      .attr('font-size', 15)
      .attr('fill', '#555')
      .text(this.opts.xLabel ?? '');

    this.yLabelEl = this.root
      .append('text')
      .attr('transform', `translate(15, ${(this.height - m.bottom + m.top) / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .attr('font-size', 15)
      .attr('fill', '#555')
      .text(this.opts.yLabel ?? '');

    this.linesG = this.root.append('g').attr('class', 'lines');
  }

  update(traces: TimeSeriesTrace[]): void {
    if (traces.length === 0) return;
    const T = Math.max(...traces.map((t) => t.values.length));
    this.xScale.domain([0, Math.max(1, T - 1)]);
    let yMin = this.opts.yMin ?? Infinity;
    let yMax = this.opts.yMax ?? -Infinity;
    if (this.opts.yMin === undefined || this.opts.yMax === undefined) {
      for (const tr of traces) {
        for (const v of tr.values) {
          if (Number.isFinite(v)) {
            if (this.opts.yMin === undefined && v < yMin) yMin = v;
            if (this.opts.yMax === undefined && v > yMax) yMax = v;
          }
        }
      }
      if (!Number.isFinite(yMin)) yMin = 0;
      if (!Number.isFinite(yMax)) yMax = 1;
      if (yMin === yMax) {
        yMin -= 1;
        yMax += 1;
      } else if (!this.opts.yLog) {
        const pad = (yMax - yMin) * 0.05;
        yMin -= pad;
        yMax += pad;
      }
    }
    this.yScale.domain([yMin, yMax]);

    this.xAxisG.call(d3.axisBottom(this.xScale).ticks(5));
    this.yAxisG.call(
      (d3.axisLeft(this.yScale) as any).ticks(5, this.opts.yLog ? '.1g' : undefined),
    );

    const lineGen = d3
      .line<number>()
      .x((_, i) => this.xScale(i))
      .y((d) => this.yScale(d))
      .defined((d) => Number.isFinite(d));

    const join = this.linesG
      .selectAll<SVGGElement, TimeSeriesTrace>('g.trace')
      .data(traces, (d) => d.id);
    join.exit().remove();
    const enter = join.enter().append('g').attr('class', 'trace');
    enter.append('path').attr('fill', 'none').attr('stroke-width', 2);
    enter.append('g').attr('class', 'stems');

    const all = enter.merge(join);
    all.each((d, i, nodes) => {
      const g = d3.select(nodes[i]);
      const path = g.select<SVGPathElement>('path');
      const stems = g.select<SVGGElement>('g.stems');
      const color = d.color ?? d3.schemeCategory10[i % 10];
      const width = d.width ?? 2;
      if (d.style === 'stem') {
        path.attr('d', '');
        const baseY = this.yScale(Math.max(this.yScale.domain()[0], 0));
        stems
          .selectAll<SVGLineElement, number>('line')
          .data(d.values)
          .join('line')
          .attr('x1', (_, idx) => this.xScale(idx))
          .attr('x2', (_, idx) => this.xScale(idx))
          .attr('y1', baseY)
          .attr('y2', (v) => this.yScale(v))
          .attr('stroke', color)
          .attr('stroke-width', 1.5);
        stems
          .selectAll<SVGCircleElement, number>('circle')
          .data(d.values)
          .join('circle')
          .attr('cx', (_, idx) => this.xScale(idx))
          .attr('cy', (v) => this.yScale(v))
          .attr('r', 2.5)
          .attr('fill', color);
      } else {
        stems.selectAll('*').remove();
        path
          .attr('d', lineGen(d.values) ?? '')
          .attr('stroke', color)
          .attr('stroke-width', width)
          .attr('stroke-dasharray', d.dasharray ?? null);
      }
    });
  }
}
