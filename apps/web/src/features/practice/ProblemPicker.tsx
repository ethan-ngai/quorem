/** @file ProblemPicker.tsx @description Shared searchable question picker for session setup. @module practice */
import { Disclosure } from "../../ui/Disclosure";
import * as Popover from "../../ui/Popover";
import { useId, useLayoutEffect, useRef, useState, type UIEvent } from "react";
import { AlertCircle, Dices } from "lucide-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { DevelopmentIdentity, ProblemVersion } from "@quorem/contracts";
import { api, requireData } from "../../api/client";
import { CatalogFilters } from "./CatalogFilters";
import { QuestionIndicators } from "./QuestionIndicators";
import type { CatalogSearch } from "./catalogSearch";
import "./practice.css";
import { SearchField } from "../../ui/SearchField";
import { useServerSearch } from "../../ui/useServerSearch";
import { scopedPlaceholder } from "../../ui/scopedPlaceholder";
import { Icon } from "../../ui/Icon";
import { LoadingIndicator } from "../../ui/Spinner";
import { Tooltip } from "../../ui/Tooltip";
import "../matches/competitive.css";

const pageSize = 30;
const prefetchLeadMs = 600;
const maxPrefetchDistance = 1200;

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
  discloseFilters = false,
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
  discloseFilters?: boolean;
}) {
  const warningId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputSearch = useServerSearch(search, setSearch);
  const [localFilters, setLocalFilters] = useState<CatalogSearch>({});
  const filters = onFiltersChange ? (externalFilters ?? {}) : localFilters;
  const allowed = difficulties?.join(",");
  const selectedDifficulties = filters.difficulty
    ?.split(",")
    .filter((value) => !difficulties || difficulties.includes(value));
  const noAllowedDifficulty = !!filters.difficulty && selectedDifficulties?.length === 0;
  const scope = ["picker-catalog-infinite", identity, library, allowed] as const;
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
            sql: filters.sql ?? "false",
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
      <CatalogFilters
        search={filters}
        update={update}
        topics={facets.data?.topics ?? []}
        companies={facets.data?.companies ?? []}
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
          ref={popover}
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
          <div
            ref={results}
            className="problem-picker-results"
            role="group"
            aria-label="Matching problems"
            aria-busy={!noAllowedDifficulty && catalog.isFetching}
            onScroll={prefetchOnScroll}
          >
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
                aria-disabled={replacingRows || undefined}
                onClick={() => choose(item.id)}
              >
                {value === item.id && <Icon name="submit" />}
                <span className="problem-picker-title">{item.title}</span>
                <QuestionIndicators privateQuestion={!!item.isPrivate} odyssey={!!item.odyssey} />
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
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
  return (
    <div className="problem-picker">
      {discloseFilters ? (
        <Disclosure
          title="Question filters"
          highlighted={Object.values(filters).some((value) => value && value !== "false")}
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
      {allowRandom && (
        <div className="sr-only" id={warningId} role="status">
          {randomWarning}
        </div>
      )}
    </div>
  );
}
