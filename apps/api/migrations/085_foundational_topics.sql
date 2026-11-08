CREATE TABLE public.foundational_topics (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 67),
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  aliases text[] NOT NULL DEFAULT '{}'
);

INSERT INTO public.foundational_topics(slug, label, aliases) VALUES
  ('backtracking', 'Backtracking', '{}'),
  ('binary-search', 'Binary Search', '{}'),
  ('binary-search-trees', 'Binary Search Trees', '{binary-search-tree,bst}'),
  ('bit-manipulation', 'Bit Manipulation', '{}'),
  ('breadth-first-search', 'Breadth-First Search', '{bfs}'),
  ('depth-first-search', 'Depth-First Search', '{dfs}'),
  ('divide-and-conquer', 'Divide & Conquer', '{divide-conquer}'),
  ('dynamic-programming', 'Dynamic Programming', '{dp}'),
  ('greedy', 'Greedy', '{}'),
  ('heap', 'Heap', '{heaps,heap-priority-queue,priority-queue}'),
  ('intervals', 'Intervals', '{interval,merge-intervals}'),
  ('linked-list', 'Linked List', '{linked-lists}'),
  ('minimum-spanning-trees', 'Minimum Spanning Trees', '{minimum-spanning-tree,mst}'),
  ('monotonic-stack', 'Monotonic Stack', '{}'),
  ('prefix-sums', 'Prefix Sums', '{prefix-sum}'),
  ('queue', 'Queue', '{queues}'),
  ('recursion', 'Recursion', '{}'),
  ('shortest-paths', 'Shortest Paths', '{shortest-path}'),
  ('sliding-window', 'Sliding Window', '{}'),
  ('sorting', 'Sorting', '{}'),
  ('stack', 'Stack', '{stacks}'),
  ('strings', 'Strings', '{string}'),
  ('topological-sort', 'Topological Sort', '{topological-sorting}'),
  ('tries', 'Tries', '{trie}'),
  ('two-pointers', 'Two Pointers', '{}'),
  ('union-find', 'Union-Find', '{disjoint-set,disjoint-set-union}');
