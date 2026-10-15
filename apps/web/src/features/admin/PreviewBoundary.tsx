/** @file PreviewBoundary.tsx @description Incomplete drafts cannot crash the authoring workspace. @module admin */
import { Component, type ReactNode } from "react";

export class PreviewBoundary extends Component<{ children: ReactNode }, { invalid: boolean }> {
  state = { invalid: false };
  static getDerivedStateFromError() {
    return { invalid: true };
  }
  render() {
    return this.state.invalid ? (
      <p role="alert">
        This draft cannot be previewed yet. Correct its signature, examples and constraints.
      </p>
    ) : (
      this.props.children
    );
  }
}
