/** @file ProblemPicker.tsx @description Shared searchable question picker for session setup. @module practice */
import * as Popover from "../../ui/Popover";
import { useId, useRef, useState } from "react";
import { AlertCircle, Dices, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { DevelopmentIdentity, ProblemVersion } from "@quorem/contracts";
import { api, requireData } from "../../api/client";
import { CatalogFilters } from "./CatalogFilters";
import { QuestionIndicators } from "./QuestionIndicators";
import type { CatalogSearch } from "./catalogSearch";
import "./practice.css";
import { Icon } from "../../ui/Icon";
import { Tooltip } from "../../ui/Tooltip";
import "../matches/competitive.css";

export function ProblemPicker({
  items,
  value,
  onChange,
  disabled,
  allowRandom = false,
  identity,
  library,
  difficulties,
  filters: externalFilters,
  onFiltersChange,
  label = "Problem",
}: {
  items: readonly { id: string; title: string; difficulty?: string }[];
  value?: string;
  onChange: (id: string | undefined, problem?: ProblemVersion) => void;
  disabled?: boolean;
  allowRandom?: boolean;
  identity?: DevelopmentIdentity;
  library?: "private" | "global";
  difficulties?: readonly string[];
  filters?: CatalogSearch;
  onFiltersChange?: (filters: CatalogSearch) => void;
  label?: string;
}) {
  const warningId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [localFilters, setLocalFilters] = useState<CatalogSearch>({});
  const filters = onFiltersChange ? (externalFilters ?? {}) : localFilters;
  const [page, setPage] = useState(1);
  const allowed = difficulties?.join(",");
  const selectedDifficulties = filters.difficulty
    ?.split(",")
    .filter((value) => !difficulties || difficulties.includes(value));
  const noAllowedDifficulty = !!filters.difficulty && selectedDifficulties?.length === 0;
  const catalog = useQuery({
    queryKey: ["picker-catalog", identity, library, search, filters, allowed, page],
    enabled: open && !noAllowedDifficulty,
    queryFn: async () => {
      const { data, error } = await api(identity).GET("/v1/problems", {
        params: {
          query: {
            ...filters,
            sql: filters.sql ?? "false",
            q: search.trim() || undefined,
            library,
            difficulty: selectedDifficulties?.join(",") || allowed,
            page,
            limit: 100,
          },
        },
      });
      return requireData(data, error);
    },
  });
  const randomPool = useQuery({
    queryKey: ["random-pool", identity, library, filters, allowed],
    enabled: allowRandom && !value && !disabled && !noAllowedDifficulty,
    queryFn: async () => {
      const { data, error } = await api(identity).GET("/v1/problems", {
        params: {
          query: {
            ...filters,
            sql: filters.sql ?? "false",
            library,
            difficulty: selectedDifficulties?.join(",") || allowed,
            limit: 1,
          },
        },
      });
      return requireData(data, error);
    },
  });
  const emptyRandomPool = noAllowedDifficulty || randomPool.data?.total === 0;
  const randomWarning =
    allowRandom && !value
      ? emptyRandomPool
        ? "No questions match these filters. Choose other filters."
        : randomPool.isError
          ? "Could not check matching questions. Try again."
          : undefined
      : undefined;
  const update = (change: Partial<CatalogSearch>) => {
    if (onFiltersChange) onFiltersChange({ ...filters, ...change });
    else setLocalFilters((current) => ({ ...current, ...change }));
    setPage(1);
  };
  const facets = useQuery({
    queryKey: ["picker-facets", identity, library],
    enabled: !disabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await api(identity).GET("/v1/problems", {
        params: { query: { library, limit: 1 } },
      });
      return requireData(data, error);
    },
  });
  const [chosen, setChosen] = useState<{ id: string; title: string }>();
  const input = useRef<HTMLInputElement>(null);
  const selected =
    items.find((item) => item.id === value) ?? (chosen?.id === value ? chosen : undefined);
  const filtered = noAllowedDifficulty ? [] : (catalog.data?.items ?? []);
  function choose(id: string | undefined) {
    setChosen(filtered.find((item) => item.id === id) ?? items.find((item) => item.id === id));
    onChange(
      id,
      filtered.find((item) => item.id === id),
    );
    setOpen(false);
  }
  return (
    <div className="problem-picker">
      <Popover.Root
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value) {
            setSearch("");
            setPage(1);
          }
        }}
      >
        <Tooltip content={randomWarning} disabled={!randomWarning}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="select-field match-choice problem-picker-trigger"
              data-warning={!!randomWarning || undefined}
              disabled={disabled}
              aria-label={label}
              aria-describedby={randomWarning ? warningId : undefined}
            >
              {allowRandom && !value ? (
                <span className="problem-picker-labels" aria-hidden="true">
                  <span className="problem-picker-label problem-picker-label-default">
                    <Dices size={16} />
                    Random
                  </span>
                  <span className="problem-picker-label problem-picker-label-warning">
                    <AlertCircle size={16} />
                    {!emptyRandomPool && randomPool.isError
                      ? "Could not check questions"
                      : "No matching questions"}
                  </span>
                </span>
              ) : (
                <span>{selected?.title ?? (value ? "Selected problem" : "Choose question")}</span>
              )}
              <span className="select-field-chevron">
                <Icon name="chevron" />
              </span>
            </button>
          </Popover.Trigger>
        </Tooltip>
        <Popover.Portal>
          <Popover.Content
            className="problem-picker-popover"
            sideOffset={8}
            collisionPadding={12}
            align="end"
            aria-label="Choose problem"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              input.current?.focus();
            }}
          >
            <label className="problem-picker-search">
              <Search size={16} />
              <input
                ref={input}
                aria-label="Search problems"
                placeholder="Search problems"
                value={search}
                maxLength={120}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <div className="problem-picker-results" role="group" aria-label="Matching problems">
              {allowRandom && (
                <button
                  type="button"
                  className="problem-picker-item"
                  aria-pressed={!value}
                  onClick={() => choose(undefined)}
                >
                  <Dices size={18} />
                  <span className="problem-picker-title">Random</span>
                  {!value && <Icon name="submit" />}
                </button>
              )}
              {filtered.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className="problem-picker-item"
                  aria-pressed={value === item.id}
                  onClick={() => choose(item.id)}
                >
                  {value === item.id && <Icon name="submit" />}
                  <span className="problem-picker-title">{item.title}</span>
                  <QuestionIndicators privateQuestion={!!item.isPrivate} odyssey={!!item.odyssey} />
                  <small className={`difficulty-${item.difficulty}`}>{item.difficulty}</small>
                </button>
              ))}
              {catalog.isError ? (
                <p role="alert">Questions unavailable. Please try again.</p>
              ) : catalog.isFetching ? (
                <p role="status">Loading questions…</p>
              ) : (
                !filtered.length && <p role="status">No matching problems</p>
              )}
            </div>
            {(page > 1 || (catalog.data?.total ?? 0) > 100) && (
              <div className="picker-pagination">
                <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                <span>Page {page}</span>
                <button
                  type="button"
                  disabled={page * 100 >= (catalog.data?.total ?? 0)}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <fieldset
        className="practice-filters picker-filters"
        disabled={disabled}
        aria-label="Question filters"
      >
        <CatalogFilters
          search={filters}
          update={update}
          topics={facets.data?.topics ?? []}
          companies={facets.data?.companies ?? []}
          showDifficulty={!difficulties}
        />
      </fieldset>
      {allowRandom && (
        <div className="sr-only" id={warningId} role="status">
          {randomWarning}
        </div>
      )}
    </div>
  );
}
