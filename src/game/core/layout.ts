/**
 * DOM-like flexbox layout for Pixi containers, backed by yoga-layout (no DOM dependency).
 *   const row = new Box({ dir: 'row', gap: 12, padding: 16, align: 'center' });
 *   row.add(new Box({ width: 80, height: 80 })).add(Box.wrap(someSprite));
 *   row.layout(1920, 1080);
 */
import Yoga, { Align, Edge, FlexDirection, Gutter, Justify, PositionType, Wrap, Direction, type Node as YNode } from 'yoga-layout';
import { Container, type ContainerChild } from 'pixi.js';

type Len = number | `${number}%` | 'auto';
type Pad = number | [number, number] | [number, number, number, number];

export interface BoxStyle {
  dir?: 'row' | 'column';
  gap?: number;
  padding?: Pad;
  margin?: Pad;
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  alignSelf?: 'start' | 'center' | 'end' | 'stretch' | 'auto';
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
  wrap?: boolean;
  width?: Len;
  height?: Len;
  minWidth?: Len;
  minHeight?: Len;
  maxWidth?: Len;
  maxHeight?: Len;
  grow?: number;
  shrink?: number;
  basis?: Len;
  absolute?: boolean;
  left?: Len;
  top?: Len;
  right?: Len;
  bottom?: Len;
}

const ALIGN: Record<string, Align> = { start: Align.FlexStart, center: Align.Center, end: Align.FlexEnd, stretch: Align.Stretch, baseline: Align.Baseline, auto: Align.Auto };
const JUSTIFY: Record<string, Justify> = { start: Justify.FlexStart, center: Justify.Center, end: Justify.FlexEnd, between: Justify.SpaceBetween, around: Justify.SpaceAround, evenly: Justify.SpaceEvenly };

function pad4(p: Pad): [number, number, number, number] {
  if (typeof p === 'number') return [p, p, p, p];
  if (p.length === 2) return [p[0], p[1], p[0], p[1]];
  return p;
}

export class Box extends Container {
  readonly node: YNode;
  readonly boxChildren: Box[] = [];
  style: BoxStyle;
  /** computed size after layout */
  w = 0;
  h = 0;
  /** called after layout with the computed size (draw backgrounds here) */
  onLayout?: (w: number, h: number) => void;
  /** a wrapped fixed-size display object */
  private leaf?: ContainerChild;

  constructor(style: BoxStyle = {}) {
    super();
    this.node = Yoga.Node.create();
    this.style = style;
    this.applyStyle(style);
  }

  /** wrap a display object as a fixed-size leaf box (size measured from its local bounds unless given) */
  static wrap(obj: ContainerChild, style: BoxStyle = {}): Box {
    const b = new Box(style);
    b.leaf = obj;
    b.addChild(obj);
    if (style.width === undefined || style.height === undefined) b.measure();
    return b;
  }

  measure() {
    if (!this.leaf) return;
    const bounds = this.leaf.getLocalBounds();
    if (this.style.width === undefined) this.node.setWidth(Math.ceil(bounds.width));
    if (this.style.height === undefined) this.node.setHeight(Math.ceil(bounds.height));
  }

  setStyle(s: Partial<BoxStyle>) {
    this.style = { ...this.style, ...s };
    this.applyStyle(this.style);
    return this;
  }

  private applyStyle(s: BoxStyle) {
    const n = this.node;
    n.setFlexDirection(s.dir === 'row' ? FlexDirection.Row : FlexDirection.Column);
    if (s.gap !== undefined) n.setGap(Gutter.All, s.gap);
    if (s.padding !== undefined) { const [t, r, b, l] = pad4(s.padding); n.setPadding(Edge.Top, t); n.setPadding(Edge.Right, r); n.setPadding(Edge.Bottom, b); n.setPadding(Edge.Left, l); }
    if (s.margin !== undefined) { const [t, r, b, l] = pad4(s.margin); n.setMargin(Edge.Top, t); n.setMargin(Edge.Right, r); n.setMargin(Edge.Bottom, b); n.setMargin(Edge.Left, l); }
    if (s.align) n.setAlignItems(ALIGN[s.align]!);
    if (s.alignSelf) n.setAlignSelf(ALIGN[s.alignSelf]!);
    if (s.justify) n.setJustifyContent(JUSTIFY[s.justify]!);
    n.setFlexWrap(s.wrap ? Wrap.Wrap : Wrap.NoWrap);
    if (s.width !== undefined) n.setWidth(s.width);
    if (s.height !== undefined) n.setHeight(s.height);
    if (s.minWidth !== undefined) n.setMinWidth(s.minWidth as number);
    if (s.minHeight !== undefined) n.setMinHeight(s.minHeight as number);
    if (s.maxWidth !== undefined) n.setMaxWidth(s.maxWidth as number);
    if (s.maxHeight !== undefined) n.setMaxHeight(s.maxHeight as number);
    if (s.grow !== undefined) n.setFlexGrow(s.grow);
    if (s.shrink !== undefined) n.setFlexShrink(s.shrink);
    if (s.basis !== undefined) n.setFlexBasis(s.basis);
    n.setPositionType(s.absolute ? PositionType.Absolute : PositionType.Relative);
    if (s.left !== undefined) n.setPosition(Edge.Left, s.left as number);
    if (s.top !== undefined) n.setPosition(Edge.Top, s.top as number);
    if (s.right !== undefined) n.setPosition(Edge.Right, s.right as number);
    if (s.bottom !== undefined) n.setPosition(Edge.Bottom, s.bottom as number);
  }

  add(child: Box | ContainerChild, style?: BoxStyle): this {
    const b = child instanceof Box ? child : Box.wrap(child, style);
    this.node.insertChild(b.node, this.boxChildren.length);
    this.boxChildren.push(b);
    this.addChild(b);
    return this;
  }

  remove(child: Box) {
    const i = this.boxChildren.indexOf(child);
    if (i < 0) return;
    this.node.removeChild(child.node);
    this.boxChildren.splice(i, 1);
    this.removeChild(child);
  }

  clear() {
    for (const c of [...this.boxChildren]) { this.remove(c); c.destroyBox(); }
  }

  /** compute layout from this node as root and apply positions recursively */
  layout(width?: number, height?: number) {
    this.node.calculateLayout(width ?? 'auto' as never, height ?? 'auto' as never, Direction.LTR);
    this.apply();
    return this;
  }

  private apply() {
    const l = this.node.getComputedLayout();
    this.w = l.width;
    this.h = l.height;
    this.onLayout?.(l.width, l.height);
    for (const c of this.boxChildren) {
      const cl = c.node.getComputedLayout();
      c.position.set(cl.left, cl.top);
      c.apply();
    }
  }

  /** free the yoga subtree and destroy the display tree; call on detached/root boxes only */
  destroyBox() {
    this.node.freeRecursive();
    this.destroy({ children: true });
  }
}
