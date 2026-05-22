/*
 * ZPlane: a z-plane scatter plot of poles (×) and zeros (○) with the unit
 * circle drawn through, optional drag interactions, and optional decorations
 * (ghost target poles, contour for the argument-principle widget, etc.).
 *
 * Mount with `new ZPlane(svgElement, options)`. Re-render with `update(data)`.
 * The widget reads pixel size from the SVG's bounding box at construction; if
 * the SVG resizes, call `resize()` explicitly.
 *
 * Coordinates are passed in as raw complex { re, im }; the plot's view range
 * defaults to [-1.3, 1.3] in each axis (i.e., a little bigger than the unit
 * circle) but is configurable.
 */

import * as d3 from 'd3';
import type { Complex } from '../complex';

export interface ZPlanePoint {
  z: Complex;
  /** Symbolic id — used by drag callbacks and to key DOM updates. */
  id: string;
  /** Optional color override (defaults to per-kind CSS). */
  color?: string;
  /** Pole / zero / ghost / target. */
  kind: 'pole' | 'zero' | 'ghost-pole' | 'ghost-zero';
  /** If false, the point cannot be dragged. Default true for poles/zeros, false for ghost-*. */
  draggable?: boolean;
}

export interface ZPlaneTrail {
  /** Symbolic id — keys DOM updates. */
  id: string;
  /** Polyline vertices in raw complex coordinates. */
  points: Complex[];
  /** Stroke color. Defaults to a muted gray. */
  color?: string;
  /** Optional SVG dash pattern (e.g. '4 3'). */
  dash?: string;
}

export interface ZPlaneOptions {
  width?: number;
  height?: number;
  /** Half-range of the viewport in each axis. Default 1.3. */
  range?: number;
  /** Viewport center in complex coords. Default origin. Use to zoom into a region. */
  center?: Complex;
  /** Called whenever a draggable point is moved by the user. */
  onDrag?: (id: string, z: Complex) => void;
  /** Called when a drag gesture ends. */
  onDragEnd?: (id: string, z: Complex) => void;
  /** If true, snap mirror-pair updates (complex conjugates) automatically. Default false. */
  conjugateLock?: boolean;
}

export class ZPlane {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private opts: Required<Pick<ZPlaneOptions, 'range' | 'conjugateLock'>> &
    ZPlaneOptions;
  private width = 0;
  private height = 0;
  private xScale!: d3.ScaleLinear<number, number>;
  private yScale!: d3.ScaleLinear<number, number>;
  private root!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private points: ZPlanePoint[] = [];
  private trails: ZPlaneTrail[] = [];

  constructor(svgEl: SVGSVGElement, opts: ZPlaneOptions = {}) {
    this.svg = d3.select(svgEl);
    this.opts = {
      range: opts.range ?? 1.3,
      conjugateLock: opts.conjugateLock ?? false,
      ...opts,
    };
    this.initLayout();
    this.drawStatic();
  }

  private initLayout(): void {
    // Use a fixed internal coordinate system. The SVG's actual rendered size
    // is driven by CSS (typically width:100%), and the viewBox scales it to
    // fit. This removes any dependency on getBoundingClientRect at mount time,
    // which was unreliable before CSS layout settled.
    this.width = this.opts.width ?? 300;
    this.height = this.opts.height ?? this.width;
    // Square aspect; pick the smaller of width / height.
    const dim = Math.min(this.width, this.height);
    this.width = dim;
    this.height = dim;
    this.svg
      .attr('viewBox', `0 0 ${this.width} ${this.height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const margin = 24;
    const inner = this.width - 2 * margin;
    const r = this.opts.range;
    const cx = this.opts.center?.re ?? 0;
    const cy = this.opts.center?.im ?? 0;
    this.xScale = d3.scaleLinear().domain([cx - r, cx + r]).range([margin, margin + inner]);
    this.yScale = d3.scaleLinear().domain([cy - r, cy + r]).range([margin + inner, margin]); // flipped: math-up

    this.root = this.svg.append('g').attr('class', 'zplane-root');
  }

  private drawStatic(): void {
    const { root, xScale, yScale } = this;
    const r = this.opts.range;
    const cx = this.opts.center?.re ?? 0;
    const cy = this.opts.center?.im ?? 0;
    const xLo = cx - r;
    const xHi = cx + r;
    const yLo = cy - r;
    const yHi = cy + r;

    // Background grid (axes through origin + light gridlines).
    const grid = root.append('g').attr('class', 'zplane-grid');
    const ticks = xScale.ticks(5);
    grid
      .selectAll('line.x')
      .data(ticks)
      .join('line')
      .attr('class', 'gridline')
      .attr('x1', (d) => xScale(d))
      .attr('x2', (d) => xScale(d))
      .attr('y1', yScale(yLo))
      .attr('y2', yScale(yHi));
    grid
      .selectAll('line.y')
      .data(ticks)
      .join('line')
      .attr('class', 'gridline')
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('x1', xScale(xLo))
      .attr('x2', xScale(xHi));

    // Axes through the origin.
    root
      .append('line')
      .attr('class', 'axis-line')
      .attr('x1', xScale(xLo))
      .attr('x2', xScale(xHi))
      .attr('y1', yScale(0))
      .attr('y2', yScale(0))
      .attr('stroke', '#999');
    root
      .append('line')
      .attr('class', 'axis-line')
      .attr('x1', xScale(0))
      .attr('x2', xScale(0))
      .attr('y1', yScale(yLo))
      .attr('y2', yScale(yHi))
      .attr('stroke', '#999');

    // Unit circle.
    root
      .append('circle')
      .attr('class', 'unit-circle')
      .attr('cx', xScale(0))
      .attr('cy', yScale(0))
      .attr('r', xScale(1) - xScale(0));

    // Axis labels.
    root
      .append('text')
      .attr('x', xScale(xHi) - 6)
      .attr('y', yScale(0) - 6)
      .attr('text-anchor', 'end')
      .attr('font-size', 14)
      .attr('fill', '#888')
      .text('Re');
    root
      .append('text')
      .attr('x', xScale(0) + 6)
      .attr('y', yScale(yHi) + 12)
      .attr('font-size', 14)
      .attr('fill', '#888')
      .text('Im');

    // Trajectory trails — drawn beneath the markers.
    root.append('g').attr('class', 'trails');

    // Marker container — drawn on top.
    root.append('g').attr('class', 'markers');
  }

  update(points: ZPlanePoint[]): void {
    this.points = points;
    const { xScale, yScale } = this;
    const markers = this.root.select<SVGGElement>('g.markers');

    const join = markers.selectAll<SVGGElement, ZPlanePoint>('g.marker').data(points, (d) => d.id);

    join.exit().remove();

    const enter = join
      .enter()
      .append('g')
      .attr('class', (d) => `marker marker-${d.kind}`)
      .attr('data-id', (d) => d.id);

    // For each marker, render the shape based on kind.
    enter.each(function (d) {
      const g = d3.select(this);
      if (d.kind === 'pole' || d.kind === 'ghost-pole') {
        // × shape.
        g.append('line')
          .attr('x1', -6).attr('y1', -6).attr('x2', 6).attr('y2', 6)
          .attr('stroke', d.color ?? null)
          .attr('class', d.kind === 'ghost-pole' ? 'ghost-pole-stroke' : 'pole-stroke');
        g.append('line')
          .attr('x1', -6).attr('y1', 6).attr('x2', 6).attr('y2', -6)
          .attr('stroke', d.color ?? null)
          .attr('class', d.kind === 'ghost-pole' ? 'ghost-pole-stroke' : 'pole-stroke');
      } else {
        // ○ shape.
        g.append('circle')
          .attr('r', 6)
          .attr('class', d.kind === 'ghost-zero' ? 'ghost-zero-marker' : 'zero-marker')
          .attr('stroke', d.color ?? null);
      }
    });

    // Position (both enter and update).
    join
      .merge(enter)
      .attr('transform', (d) => `translate(${xScale(d.z.re)}, ${yScale(d.z.im)})`);

    // Drag behavior — attach to every draggable marker.
    const onDrag = this.opts.onDrag;
    const onDragEnd = this.opts.onDragEnd;
    if (onDrag || onDragEnd) {
      const xScaleInv = this.xScale.invert.bind(this.xScale);
      const yScaleInv = this.yScale.invert.bind(this.yScale);
      const conjugateLock = this.opts.conjugateLock;
      const points = this.points;
      const range = this.opts.range;
      markers.selectAll<SVGGElement, ZPlanePoint>('g.marker').each(function (d) {
        const draggable = d.draggable ?? (d.kind === 'pole' || d.kind === 'zero');
        if (!draggable) return;
        const sel = d3.select<SVGGElement, ZPlanePoint>(this);
        sel.style('cursor', 'grab').call(
          d3
            .drag<SVGGElement, ZPlanePoint>()
            .on('start', function () {
              d3.select(this).style('cursor', 'grabbing');
            })
            .on('drag', function (event, datum) {
              const [mx, my] = d3.pointer(event, (sel.node() as SVGGElement).ownerSVGElement!);
              let re = xScaleInv(mx);
              let im = yScaleInv(my);
              // Clamp to viewport.
              re = Math.max(-range, Math.min(range, re));
              im = Math.max(-range, Math.min(range, im));
              onDrag?.(datum.id, { re, im });
              // If conjugate locking, also notify of the paired point.
              if (conjugateLock && Math.abs(im) > 1e-3) {
                const partner = points.find((p) => p.id === conjugatePairId(datum.id));
                if (partner) onDrag?.(partner.id, { re, im: -im });
              }
            })
            .on('end', function (event, datum) {
              d3.select(this).style('cursor', 'grab');
              const [mx, my] = d3.pointer(event, (sel.node() as SVGGElement).ownerSVGElement!);
              const re = xScaleInv(mx);
              const im = yScaleInv(my);
              onDragEnd?.(datum.id, { re, im });
            }),
        );
      });
    }
  }

  /** Draw polyline trails (e.g. a swept trajectory) beneath the markers. */
  setTrails(trails: ZPlaneTrail[]): void {
    this.trails = trails;
    const { xScale, yScale } = this;
    const line = d3
      .line<Complex>()
      .x((d) => xScale(d.re))
      .y((d) => yScale(d.im));
    const g = this.root.select<SVGGElement>('g.trails');
    const join = g
      .selectAll<SVGPathElement, ZPlaneTrail>('path.trail')
      .data(trails, (d) => d.id);
    join.exit().remove();
    join
      .enter()
      .append('path')
      .attr('class', 'trail')
      .attr('fill', 'none')
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .merge(join)
      .attr('d', (d) => line(d.points))
      .attr('stroke', (d) => d.color ?? '#888')
      .attr('stroke-width', 1.8)
      .attr('stroke-dasharray', (d) => d.dash ?? null);
  }

  /** Recenter (and optionally rescale) the viewport, then redraw. */
  setView(center: Complex, range?: number): void {
    this.opts.center = center;
    if (range !== undefined) this.opts.range = range;
    this.resize();
  }

  resize(): void {
    this.svg.selectAll('*').remove();
    this.initLayout();
    this.drawStatic();
    if (this.trails.length) this.setTrails(this.trails);
    if (this.points.length) this.update(this.points);
  }
}

/** Convention: pole-pair ids are "pole-k" / "pole-k-conj"; similarly for zeros. */
function conjugatePairId(id: string): string {
  if (id.endsWith('-conj')) return id.slice(0, -'-conj'.length);
  return `${id}-conj`;
}
