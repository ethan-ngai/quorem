import "./sql-tables.css";
import type { ProblemVersion } from "@quorem/contracts";

type Column = { name: string; type?: string };
type Table = { name?: string; columns: Column[]; rows: unknown[][] };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTable(value: unknown, input: boolean): Table | undefined {
  if (!record(value) || !Array.isArray(value.columns) || !Array.isArray(value.rows)) return;
  const columns = value.columns.map((column: unknown) => {
    if (!input && typeof column === "string") return { name: column };
    if (record(column) && typeof column.name === "string")
      return { name: column.name, type: typeof column.type === "string" ? column.type : undefined };
    return undefined;
  });
  if (columns.some((column) => !column) || !value.rows.every(Array.isArray)) return;
  return {
    name: typeof value.name === "string" ? value.name : undefined,
    columns: columns as Column[],
    rows: value.rows as unknown[][],
  };
}

function cellValue(value: unknown): string {
  if (value === null) return "NULL";
  if (record(value)) {
    if (typeof value.$numeric === "string") return value.$numeric;
    if (typeof value.$bigint === "string") return value.$bigint;
  }
  if (typeof value === "string") return value === "" ? "''" : value;
  return JSON.stringify(value) ?? "";
}

function SqlTable({ table, label }: { table: Table; label: string }) {
  return (
    <div className="sql-table-block">
      <div className="sql-table-label">{label}</div>
      <div className="sql-table-scroll" tabIndex={0} role="region" aria-label={`${label} table`}>
        <table className="sql-table" aria-label={label}>
          <thead>
            <tr>
              {table.columns.map((column, index) => (
                <th key={index} scope="col">
                  <span>{column.name}</span>
                  {column.type && <small>{column.type}</small>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.length ? (
              table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {table.columns.map((_, index) => (
                    <td key={index} className={row[index] === null ? "sql-null" : undefined}>
                      {cellValue(row[index])}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="sql-empty" colSpan={Math.max(table.columns.length, 1)}>
                  No rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Render SQL wire values without changing their precision or row order. */
export function SqlTables({
  value,
  input,
  label,
  schema,
  columnTypes,
  useSchemaTypes = true,
}: {
  value: unknown;
  input?: boolean;
  label: string;
  schema?: ProblemVersion["sql"];
  columnTypes?: readonly string[];
  useSchemaTypes?: boolean;
}) {
  const values =
    input && record(value) && Array.isArray(value.tables) ? value.tables : input ? [] : [value];
  const tables = values.map((item: unknown) => {
    if (!record(item)) return undefined;
    const schemaColumns = input
      ? schema?.tables?.find((table) => table.name === item.name)?.columns
      : schema?.output;
    if (input)
      return parseTable(
        !Array.isArray(item.columns) && schemaColumns ? { ...item, columns: schemaColumns } : item,
        true,
      );
    const names = Array.isArray(item.columns)
      ? item.columns
      : schemaColumns?.map((column) => column.name);
    if (!names || !names.every((name) => typeof name === "string")) return undefined;
    const columns = names.map((name, index) => ({
      name,
      type:
        columnTypes?.[index] ??
        (useSchemaTypes && schemaColumns?.[index]?.name === name
          ? schemaColumns[index]?.type
          : undefined),
    }));
    return parseTable({ ...item, columns }, false);
  });
  if (!tables.length || tables.some((table) => !table))
    return <code className="machine-value">{JSON.stringify(value)}</code>;
  return (
    <div className="sql-tables">
      {tables.map((table, index) => (
        <SqlTable
          key={index}
          table={table!}
          label={input ? (table!.name ?? `Table ${index + 1}`) : label}
        />
      ))}
    </div>
  );
}

export function SqlSchema({ schema }: { schema: NonNullable<ProblemVersion["sql"]> }) {
  if (!schema.tables?.length || !schema.output?.length) return null;
  return (
    <section className="problem-section" aria-label="SQL schema">
      <h2>Schema</h2>
      <div className="sql-schema">
        {schema.tables.map((table) => (
          <div key={table.name}>
            <strong>{table.name}</strong>
            <ul>
              {table.columns.map((column) => (
                <li key={column.name}>
                  <code>{column.name}</code> <span>{column.type}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <strong>Output</strong>
          <ul>
            {schema.output.map((column, index) => (
              <li key={index}>
                <code>{column.name}</code> <span>{column.type}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
