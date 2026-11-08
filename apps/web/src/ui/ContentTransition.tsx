/** @file ContentTransition.tsx @description Crossfades content in a stable surface. @module ui */
import { Component, type ReactNode } from "react";
import { prepareContentChangeMotion } from "./contentChangeMotion";
import "./content-transition.css";

type Props = { contentKey: string; className?: string; inline?: boolean; children: ReactNode };
type StartMotion = NonNullable<ReturnType<typeof prepareContentChangeMotion>> | null;

/** Crossfade React content and resize its surface when its layout changes. */
export class ContentTransition extends Component<Props, object, StartMotion> {
  private surface: HTMLElement | null = null;
  private readonly setSurface = (surface: HTMLElement | null) => {
    this.surface = surface;
  };
  private stopMotion?: () => void;

  getSnapshotBeforeUpdate(previous: Props): StartMotion {
    if (previous.contentKey === this.props.contentKey || !this.surface) return null;
    this.stopMotion?.();
    return prepareContentChangeMotion(this.surface, this.props.inline) ?? null;
  }

  componentDidUpdate(_previous: Props, _state: object, start: StartMotion) {
    if (start) this.stopMotion = start();
  }

  componentWillUnmount() {
    this.stopMotion?.();
  }

  render() {
    if (this.props.inline) {
      return (
        <span ref={this.setSurface} className="content-transition-inline">
          <span className={this.props.className}>{this.props.children}</span>
        </span>
      );
    }
    return (
      <div ref={this.setSurface} className={this.props.className}>
        {this.props.children}
      </div>
    );
  }
}
