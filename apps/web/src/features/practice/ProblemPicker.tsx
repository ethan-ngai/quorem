/** @file ProblemPicker.tsx @description Shared searchable question picker for session setup. @module practice */
import { Disclosure } from "../../ui/Disclosure";
import * as Popover from "../../ui/Popover";
import { useId, useLayoutEffect, useRef, useState, type UIEvent } from "react";
import { AlertCircle, Dices, Lightbulb } from "lucide-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { defaultCatalogFormat } from "@quorem/contracts/catalog-filter";
import type { DevelopmentIdentity, PublishedQuestion } from "@quorem/contracts";
import { api, requireData } from "../../api/client";
import { CatalogFilters, CatalogKindFilters, topicFilterValues } from "./CatalogFilters";
import { QuestionIndicators } from "./QuestionIndicators";
import { catalogKind, catalogKindChange, type CatalogSearch } from "./catalogSearch";
import "./practice.css";
import { SearchField } from "../../ui/SearchField";
import { ScrollViewport } from "../../ui/ScrollViewport";
import { useServerSearch } from "../../ui/useServerSearch";
import { scopedPlaceholder } from "../../ui/scopedPlaceholder";
import { Icon } from "../../ui/Icon";
import { LoadingIndicator } from "../../ui/Spinner";
import { Tooltip } from "../../ui/Tooltip";
import "../matches/competitive.css";

const automaticOptions = {
  recommended: { label: "Recommended", icon: Lightbulb },
  random: { label: "Random", icon: Dices },
} as const;
type AutomaticMode = keyof typeof automaticOptions;

const pageSize = 30;
const prefetchLeadMs = 600;
const maxPrefetchDistance = 1200;

export function ProblemPicker({
  items,
  value,
  onChange,
  disabled,
  automaticSelection,
  identity,
  library,
  difficulties,
  filters: externalFilters,
  onFiltersChange,
  label = "Problem",
  discloseFilters = false,
  exclusiveKind = false,
}: {
  items: readonly { id: string; title: string; difficulty?: string }[];
  value?: string;
  onChange: (id: string | undefined, problem?: PublishedQuestion) => void;
  disabled?: boolean;
  automaticSelection?: { mode: AutomaticMode; onChange: (mode: AutomaticMode) => void };
  identity?: DevelopmentIdentity;
  library?: "private" | "global";
  difficulties?: readonly string[];
  filters?: CatalogSearch;
  onFiltersChange?: (filters: CatalogSearch, topicValues: ReadonlyMap<string, string>) => void;
  label?: string;
  discloseFilters?: boolean;
  exclusiveKind?: boolean;
}) {
  const warningId = useId();
  const automatic = automaticSelection ? automaticOptions[automaticSelection.mode] : undefined;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputSearch = useServerSearch(search, setSearch);
  const [localFilters, setLocalFilters] = useState<CatalogSearch>({});
  const savedFilters = onFiltersChange ? (externalFilters ?? {}) : localFilters;
  const filters: CatalogSearch =
    exclusiveKind && !savedFilters.type
      ? { ...savedFilters, type: defaultCatalogFormat }
      : savedFilters;
  const allowed = difficulties?.join(",");
  const selectedDifficulties = filters.difficulty
    ?.split(",")
    .filter((value) => !difficulties || difficulties.includes(value));
  const noAllowedDifficulty = !!filters.difficulty && selectedDifficulties?.length === 0;
  const [sql, type] = catalogKind(filters);
  const scope = ["picker-catalog-infinite", identity, library, allowed, sql, type] as const;
  const queryKey = [...scope, search, filters] as const;
  const resultsKey = JSON.stringify(queryKey);
  const catalog = useInfiniteQuery({
    queryKey,
    placeholderData: scopedPlaceholder(scope),
    initialPageParam: 1,
    enabled: open && !noAllowedDifficulty,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await api(identity).GET("/v1/problems", {
        signal,
        params: {
          query: {
            ...filters,
            sql,
            type,
            q: search || undefined,
            library,
            difficulty: selectedDifficulties?.join(",") || allowed,
            page: pageParam,
            limit: pageSize,
          },
        },
      });
      return requireData(data, error);
    },
    getNextPageParam: (last, pages) =>
      pages.reduce((count, page) => count + page.items.length, 0) < last.total && last.items.length
        ? pages.length + 1
        : undefined,
  });
  const candidatePool = useQuery({
    queryKey: ["picker-candidate-pool", identity, library, filters, allowed],
    enabled: automaticSelection && !value && !disabled && !noAllowedDifficulty,
    queryFn: async ({ signal }) => {
      const { data, error } = await api(identity).GET("/v1/problems", {
        signal,
        params: {
          query: {
            ...filters,
            sql,
            type,
            library,
            difficulty: selectedDifficulties?.join(",") || allowed,
            limit: 1,
          },
        },
      });
      return requireData(data, error);
    },
  });
  const emptyPool = noAllowedDifficulty || candidatePool.data?.total === 0;
  const poolWarning =
    automaticSelection && !value
      ? emptyPool
        ? "No questions match these filters. Choose other filters."
        : candidatePool.isError
          ? "Could not check matching questions. Try again."
          : undefined
      : undefined;
  const facets = useQuery({
    queryKey: ["picker-facets", identity, library, sql, type],
    enabled: !disabled,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await api(identity).GET("/v1/problems", {
        signal,
        params: { query: { library, sql, type, limit: 1 } },
      });
      return requireData(data, error);
    },
  });
  const update = (change: Partial<CatalogSearch>) => {
    if (!exclusiveKind && ("type" in change || "sql" in change)) change = catalogKindChange(change);
    if (onFiltersChange)
      onFiltersChange(
        { ...filters, ...change },
        topicFilterValues(facets.data?.foundationalTopics, facets.data?.topicAliases),
      );
    else setLocalFilters((current) => ({ ...current, ...change }));
  };
  const [chosen, setChosen] = useState<{ id: string; title: string }>();
  const popover = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const lastScroll = useRef<{ list: HTMLDivElement; top: number; time: number }>(null);
  const selected =
    items.find((item) => item.id === value) ?? (chosen?.id === value ? chosen : undefined);
  const filtered = noAllowedDifficulty
    ? []
    : (catalog.data?.pages.flatMap((page) => page.items) ?? []);
  const replacingRows = catalog.isPlaceholderData || inputSearch.text.trim() !== search;
  const settledKey = catalog.data && !catalog.isPlaceholderData ? resultsKey : undefined;
  useLayoutEffect(() => {
    if (settledKey && results.current) results.current.scrollTop = 0;
  }, [settledKey, open]);
  const canLoadMore = !replacingRows && !catalog.isFetching;
  const loadMore = () => {
    if (catalog.hasNextPage && canLoadMore && !catalog.isFetchNextPageError)
      void catalog.fetchNextPage({ cancelRefetch: false });
  };
  function prefetchOnScroll({ currentTarget: list, timeStamp }: UIEvent<HTMLDivElement>) {
    const { scrollTop: top, clientHeight: height, scrollHeight } = list;
    const previous = lastScroll.current?.list === list ? lastScroll.current : null;
    lastScroll.current = { list, top, time: timeStamp };
    const delta = top - (previous?.top ?? 0);
    if (delta <= 0) return;

    // After a pause, treat the first movement as one frame so flicks get a head start.
    const elapsed = previous ? timeStamp - previous.time : Infinity;
    const velocity = delta / (elapsed > 150 ? 16 : Math.max(16, elapsed));
    const lead = Math.max(height, Math.min(maxPrefetchDistance, velocity * prefetchLeadMs));
    if (scrollHeight - top - height <= lead) loadMore();
  }
  function choose(id: string | undefined) {
    if (id && replacingRows) return;
    inputSearch.reset();
    setOpen(false);
    if (id === value) return;
    setChosen(filtered.find((item) => item.id === id) ?? items.find((item) => item.id === id));
    onChange(
      id,
      filtered.find((item) => item.id === id),
    );
  }
  const filterControls = (
    <fieldset
      className="practice-filters picker-filters"
      disabled={disabled}
      aria-label="Question filters"
    >
      {exclusiveKind && <CatalogKindFilters iconOnly search={filters} update={update} />}
      <CatalogFilters
        search={filters}
        update={update}
        topics={facets.data?.topics ?? []}
        foundationalTopics={exclusiveKind ? facets.data?.foundationalTopics : undefined}
        topicAliases={facets.data?.topicAliases}
        companies={facets.data?.companies ?? []}
        companyFacets={facets.data?.companyFacets}
        showKind={!exclusiveKind}
        showDifficulty={!difficulties}
      />
    </fieldset>
  );
  const picker = (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        inputSearch.reset();
        if (value) {
          setSearch("");
        }
      }}
    >
      <Tooltip content={poolWarning} disabled={!poolWarning}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="select-field match-choice problem-picker-trigger"
            data-warning={!!poolWarning || undefined}
            disabled={disabled}
            aria-label={label}
            aria-describedby={poolWarning || (automatic && !value) ? warningId : undefined}
          >
            {automatic && !value ? (
              <span className="problem-picker-labels" aria-hidden="true">
                <span className="problem-picker-label problem-picker-label-default">
                  <automatic.icon size={16} />
                  {automatic.label}
                </span>
                <span className="problem-picker-label problem-picker-label-warning">
                  <AlertCircle size={16} />
                  {!emptyPool && candidatePool.isError
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
          ref={popover}
          className="problem-picker-popover"
          data-automatic-selection={!!automaticSelection || undefined}
          sideOffset={8}
          collisionPadding={12}
          align="end"
          aria-label="Choose problem"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
        >
          <SearchField
            className="problem-picker-search"
            ref={input}
            shortcutTarget={popover}
            aria-label="Search problems"
            placeholder="Search problems"
            value={inputSearch.text}
            maxLength={120}
            onChange={(event) => inputSearch.change(event.target.value)}
            refreshing={!noAllowedDifficulty && catalog.isFetching && !!catalog.data}
          />
          <ScrollViewport
            ref={results}
            className="problem-picker-results"
            role="group"
            aria-label="Matching problems"
            aria-busy={!noAllowedDifficulty && catalog.isFetching}
            onScroll={prefetchOnScroll}
          >
            {automaticSelection && (
              <div className="problem-picker-modes" role="group" aria-label="Automatic selection">
                {(Object.keys(automaticOptions) as AutomaticMode[]).map((mode) => {
                  const option = automaticOptions[mode];
                  const active = !value && automaticSelection.mode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      className="problem-picker-item"
                      aria-pressed={active}
                      onClick={() => {
                        inputSearch.reset();
                        setOpen(false);
                        if (!active) automaticSelection.onChange(mode);
                      }}
                    >
                      <option.icon size={18} aria-hidden />
                      <span className="problem-picker-title">{option.label}</span>
                      {active && <Icon name="submit" />}
                    </button>
                  );
                })}
              </div>
            )}
            {filtered.map((item) => (
              <button
                type="button"
                key={item.id}
                className="problem-picker-item"
                aria-pressed={value === item.id}
                aria-disabled={replacingRows || undefined}
                onClick={() => choose(item.id)}
              >
                {value === item.id && <Icon name="submit" />}
                <span className="problem-picker-title">{item.title}</span>
                <QuestionIndicators
                  privateQuestion={!!item.isPrivate}
                  odyssey={!exclusiveKind && !!item.odyssey}
                />
                <small className={`difficulty-${item.difficulty}`}>{item.difficulty}</small>
              </button>
            ))}
            {!noAllowedDifficulty && catalog.isError ? (
              <div role="alert">
                <p>
                  {filtered.length ? "Could not load more questions." : "Questions unavailable."}
                </p>
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() =>
                    void (catalog.isFetchNextPageError
                      ? catalog.fetchNextPage({ cancelRefetch: false })
                      : catalog.refetch())
                  }
                >
                  Retry
                </button>
              </div>
            ) : !noAllowedDifficulty && catalog.isLoading ? (
              <LoadingIndicator label="Loading questions…" />
            ) : !filtered.length ? (
              <p role="status">No matching problems</p>
            ) : catalog.hasNextPage ? (
              <button
                type="button"
                className="quiet-button"
                aria-disabled={!canLoadMore || undefined}
                onClick={loadMore}
              >
                Load more questions
              </button>
            ) : null}
          </ScrollViewport>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
  return (
    <div className="problem-picker">
      {discloseFilters ? (
        <Disclosure
          title="Question filters"
          highlighted={Object.entries(filters).some(
            ([key, value]) =>
              value && !(exclusiveKind && key === "type" && value === defaultCatalogFormat),
          )}
          header={(trigger) => (
            <div className="settings-disclosure-controls">
              {picker}
              {trigger}
            </div>
          )}
        >
          {filterControls}
        </Disclosure>
      ) : (
        <>
          {picker}
          {filterControls}
        </>
      )}
      {automaticSelection && (
        <div className="sr-only" id={warningId} role="status">
          {poolWarning ?? (!value ? automatic?.label : undefined)}
        </div>
      )}
    </div>
  );
}
