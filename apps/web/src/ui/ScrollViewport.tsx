/** @file ScrollViewport.tsx @description Shared native scroll container. @module ui */
import type { ComponentProps } from "react";
import "./scroll-viewport.css";

export function ScrollViewport({
  axis = "vertical",
  ...props
}: ComponentProps<"div"> & { axis?: "vertical" | "horizontal" }) {
  return <div {...props} data-scroll-viewport={axis} />;
}
