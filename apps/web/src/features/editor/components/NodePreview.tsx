/** @file NodePreview.tsx @description One lazy diagram per case and scoped reference picking. @module editor */
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { GRAPH_RETURN, graphReturnSlot, type CaseGraphs } from "@quorem/questions";
import { nodeValueType } from "../nodeDiagram";
import type { NodeContext } from "../nodeLiterals";
import type { WireValue } from "../typedValues";
import "./node-preview.css";
import { SelectField } from "../../../ui/SelectField";
import { LoadingIndicator } from "../../../ui/Spinner";

const GraphDiagram = lazy(() => import("./GraphDiagram"));
const Diagram = lazy(() => import("./NodeDiagram"));
type Selection = { type: string; name: string; choose: (reference: string) => void };
const ReferenceSelection = createContext<
  { active?: Selection; select: (selection: Selection) => void } | undefined
>(undefined);
export const useNodeReferenceSelection = () => useContext(ReferenceSelection);

/** Keep reference selection inside one displayed case. */
export function NodeReferenceScope({ children }: { children: ReactNode }) {
  const [active, select] = useState<Selection>();
  return (
    <ReferenceSelection.Provider value={{ active, select }}>{children}</ReferenceSelection.Provider>
  );
}

type NodePreviewProps = {
  context?: NodeContext;
  expected?: unknown;
  actual?: unknown;
  expectedSource?: string;
};
function hasNodes(context?: NodeContext): context is NodeContext {
  return (
    !!context &&
    (!!nodeValueType(context.signature.returnType) ||
      context.signature.parameters.some(({ type }) => nodeValueType(type)))
  );
}

/** Shrink the diagram beside the complete case value stack. */
export function CasePreviewLayout({
  children,
  editable = false,
  enabled = true,
  graphs,
  ...preview
}: NodePreviewProps & {
  children: ReactNode;
  editable?: boolean;
  enabled?: boolean;
  graphs?: CaseGraphs;
}) {
  const nodes = hasNodes(preview.context);
  const hasGraphs = !!graphs && Object.keys(graphs).length > 0;
  if (!enabled || (!nodes && !hasGraphs)) return <>{children}</>;
  return (
    <div className="case-with-preview" data-editable={editable}>
      <div className="case-preview-values">{children}</div>
      {hasGraphs ? (
        <div className="node-preview">
          {nodes && <NodeCasePreview {...preview} />}
          <CaseGraphsPreview graphs={graphs} context={preview.context} />
        </div>
      ) : (
        <NodeCasePreview {...preview} />
      )}
    </div>
  );
}

/** One diagram at a time keeps cases with multiple graphs compact. */
function CaseGraphsPreview({ graphs, context }: { graphs: CaseGraphs; context?: NodeContext }) {
  const [selected, setSelected] = useState<string>();
  const keys = Object.keys(graphs);
  const first =
    context?.signature.parameters.find(({ name }) => Object.hasOwn(graphs, name))?.name ?? keys[0]!;
  const target = selected !== undefined && Object.hasOwn(graphs, selected) ? selected : first;
  const label = (name: string) => {
    if (name === GRAPH_RETURN) return "Expected graph";
    const slot = graphReturnSlot(name);
    return slot === undefined ? name : `Expected graph [${slot}]`;
  };
  return (
    <div className="case-graph-preview">
      {keys.length > 1 && (
        <SelectField
          label="Graph preview"
          value={target}
          onChange={setSelected}
          options={keys.map((name) => ({ value: name, label: label(name) }))}
        />
      )}
      <Suspense fallback={<LoadingIndicator label="Loading graph preview…" />}>
        <GraphDiagram graph={graphs[target]!} label={label(target)} caption={keys.length === 1} />
      </Suspense>
    </div>
  );
}

export function NodeCasePreview({ context, expected, actual, expectedSource }: NodePreviewProps) {
  const selection = useNodeReferenceSelection();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [naturalWidth, setNaturalWidth] = useState(220);
  useEffect(() => {
    if (!host) return;
    // Fit only once a case tab has measurable space.
    const resize = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    resize.observe(host);
    return () => resize.disconnect();
  }, [host]);
  if (!hasNodes(context)) return null;
  return (
    <div
      ref={setHost}
      className="node-preview"
      aria-label="Test case diagram"
      style={{ width: naturalWidth, maxWidth: "100%" }}
    >
      {width > 0 && (
        <Suspense fallback={<LoadingIndicator label="Loading preview…" />}>
          <Diagram
            width={width}
            onNaturalWidth={setNaturalWidth}
            context={context}
            expected={expected as WireValue}
            actual={actual as WireValue}
            expectedSource={expectedSource}
            choose={(type, ref) => {
              if (selection?.active?.type === type) selection.active.choose(ref);
            }}
            choosing={selection?.active?.name}
          />
        </Suspense>
      )}
    </div>
  );
}
