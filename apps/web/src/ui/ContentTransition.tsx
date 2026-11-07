import { Component, createRef, type ReactNode } from "react";
import { prepareContentChangeMotion } from "./contentChangeMotion";

type Props = { contentKey: string; className?: string; children: ReactNode };
type StartMotion = NonNullable<ReturnType<typeof prepareContentChangeMotion>> | null;

/** Crossfade React content and resize its surface when its layout changes. */
export class ContentTransition extends Component<Props, object, StartMotion> {
  private readonly surface = createRef<HTMLDivElement>();
  private stopMotion?: () => void;

  getSnapshotBeforeUpdate(previous: Props): StartMotion {
    if (previous.contentKey === this.props.contentKey || !this.surface.current) return null;
    this.stopMotion?.();
    return prepareContentChangeMotion(this.surface.current) ?? null;
  }

  componentDidUpdate(_previous: Props, _state: object, start: StartMotion) {
    if (start) this.stopMotion = start();
  }

  componentWillUnmount() {
    this.stopMotion?.();
  }

  render() {
    return (
      <div ref={this.surface} className={this.props.className}>
        {this.props.children}
      </div>
    );
  }
}
