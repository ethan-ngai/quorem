/** @file AdvancedSettings.tsx @description Question identity and execution controls. @module admin */
import type { QuestionContent } from "@quorem/contracts";
import {
  Building2,
  Clock3,
  Copyright,
  Layers3,
  Route,
  ListOrdered,
  MemoryStick,
  Settings2,
  Terminal,
  Workflow,
  ChevronRight,
} from "lucide-react";
import { inputConstraints } from "../../ui/input-constraints";
import { TextInput } from "../../ui/TextControl";
import { Field } from "./AuthoringFields";
import { AuthoringNumberField, LeetcodeIDField, TopicField } from "./AuthoringInputs";
import type { ReportAuthoringValidity } from "./authoringValidation";

const limits = [
  {
    name: "wallTimeMs",
    label: "Time",
    icon: Clock3,
    unit: "ms",
    scale: 1,
    hint: "Wall-clock time per test",
  },
  {
    name: "memoryBytes",
    label: "Memory",
    icon: MemoryStick,
    unit: "MiB",
    scale: 1048576,
    hint: "Memory per test",
  },
  {
    name: "outputBytes",
    label: "Output",
    icon: Terminal,
    unit: "KiB",
    scale: 1024,
    hint: "Captured output per test",
  },
  {
    name: "maxProcesses",
    label: "Processes",
    icon: Workflow,
    hint: "Maximum processes and threads",
  },
  {
    name: "maxCollectionElements",
    label: "Elements",
    icon: ListOrdered,
    hint: "Maximum elements in a collection",
  },
  { name: "maxNestingDepth", label: "Depth", icon: Layers3, hint: "Maximum input nesting depth" },
] as const;

export function AdvancedSettings({
  content,
  lockSlug,
  onChange,
  onValidityChange,
}: {
  content: QuestionContent;
  lockSlug: boolean;
  onChange: (content: QuestionContent) => void;
  onValidityChange: ReportAuthoringValidity;
}) {
  const problem = content.problem;
  const setProblem = (patch: Partial<typeof problem>) =>
    onChange({ ...content, problem: { ...problem, ...patch } });
  return (
    <details className="disclosure authoring-options">
      <summary>
        <Settings2 size={15} aria-hidden="true" /> Advanced settings
        <ChevronRight size={14} className="disclosure-chevron" aria-hidden="true" />
      </summary>
      <div className="authoring-advanced">
        <fieldset className="authoring-setting-group" aria-label="Question metadata">
          <div className="authoring-identity-fields">
            <Field
              label="Slug"
              icon={<Route size={14} aria-hidden="true" />}
              hint={lockSlug ? "Published URL; locked" : "Question URL identifier"}
            >
              <TextInput
                mono
                aria-label="Slug"
                constraint={inputConstraints.slug}
                maxLength={80}
                readOnly={lockSlug}
                value={problem.slug}
                onChange={(event) => setProblem({ slug: event.target.value })}
              />
            </Field>
            <LeetcodeIDField
              value={problem.leetcodeId ?? null}
              onChange={(leetcodeId) => setProblem({ leetcodeId })}
              onValidityChange={(invalid) => onValidityChange("leetcodeId", invalid)}
            />
          </div>
          <TopicField
            label="Companies"
            icon={<Building2 size={14} aria-hidden="true" />}
            limit={64}
            tags={problem.companies ?? []}
            onChange={(companies) => setProblem({ companies })}
          />
          <Field
            label="Attribution"
            icon={<Copyright size={14} aria-hidden="true" />}
            hint="Credit the original source"
          >
            <TextInput
              aria-label="Attribution"
              value={content.attribution}
              onChange={(event) => onChange({ ...content, attribution: event.target.value })}
            />
          </Field>
        </fieldset>
        <fieldset className="authoring-setting-group">
          <legend>
            <Settings2 size={14} aria-hidden="true" /> Execution limits
          </legend>
          <div className="authoring-limits">
            {limits.map(({ name, label, icon: Icon, hint, ...display }) => (
              <AuthoringNumberField
                key={name}
                label={label}
                icon={<Icon size={14} aria-hidden="true" />}
                hint={hint}
                {...display}
                value={problem.limits[name]}
                onValidityChange={(invalid, message) =>
                  onValidityChange(`limit:${name}`, invalid, message ? [{ message }] : undefined)
                }
                onChange={(value) => setProblem({ limits: { ...problem.limits, [name]: value } })}
              />
            ))}
          </div>
        </fieldset>
      </div>
    </details>
  );
}
