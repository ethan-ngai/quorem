import { useRef } from "react";
import { Trash2 } from "lucide-react";
import { AnimatedRows } from "../../ui/AnimatedRows";
import { Tooltip } from "../../ui/Tooltip";
import { SearchableTypeSelect } from "./SearchableTypeSelect";
import type { ProblemVersion } from "@quorem/contracts";
import { SelectField } from "../../ui/SelectField";
import { Field } from "./AuthoringFields";

type SqlSchema = NonNullable<ProblemVersion["sql"]>;
type Column = NonNullable<SqlSchema["output"]>[number];

const inputTypes = [
  "integer",
  "bigint",
  "numeric",
  "text",
  "boolean",
  "date",
  "timestamp",
  "timestamptz",
] as const satisfies readonly Column["type"][];
const outputTypes = [
  ...inputTypes,
  "real",
  "double precision",
] as const satisfies readonly Column["type"][];

function SqlColumns({
  label,
  columns,
  types,
  disabled,
  onChange,
}: {
  label: string;
  columns: Column[];
  types: readonly Column["type"][];
  disabled: boolean;
  onChange: (columns: Column[]) => void;
}) {
  const addColumn = useRef<HTMLButtonElement>(null);
  function update(index: number, patch: Partial<Column>) {
    onChange(
      columns.map((column, position) => (position === index ? { ...column, ...patch } : column)),
    );
  }
  return (
    <fieldset className="admin-fields admin-sql-columns">
      <legend>{label}</legend>
      <AnimatedRows
        items={columns}
        className="admin-sql-column-list"
        focusFallback={addColumn}
        renderRow={(column, index) => (
          <div className="admin-sql-column">
            <input
              className="admin-code"
              aria-label={`Column ${index + 1} name`}
              placeholder="Column name"
              value={column.name}
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <SearchableTypeSelect
              label={`Column ${index + 1} type`}
              value={column.type}
              disabled={disabled}
              choices={types}
              onChange={(type) => update(index, { type })}
            />
            <Tooltip content="Remove column">
              <button
                type="button"
                className="icon-button destructive-icon"
                aria-label={`Remove column ${index + 1}`}
                onClick={() => onChange(columns.filter((_, position) => position !== index))}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        )}
      />
      <button
        type="button"
        className="button button-secondary"
        ref={addColumn}
        disabled={columns.length >= 32}
        onClick={() => onChange([...columns, { name: "", type: "text" }])}
      >
        Add column
      </button>
    </fieldset>
  );
}

export function SqlSchemaFields({
  value,
  disabled,
  onChange,
}: {
  value: SqlSchema;
  disabled: boolean;
  onChange: (value: SqlSchema) => void;
}) {
  const tables = value.tables ?? [];
  const addTable = useRef<HTMLButtonElement>(null);
  function updateTable(index: number, patch: Partial<(typeof tables)[number]>) {
    onChange({
      ...value,
      tables: tables.map((table, position) =>
        position === index ? { ...table, ...patch } : table,
      ),
    });
  }
  return (
    <>
      <section>
        <h2>Input tables</h2>
        {!tables.length && (
          <p className="admin-authoring-hint">Add the tables available to the query.</p>
        )}
        <AnimatedRows
          items={tables}
          focusFallback={addTable}
          renderRow={(table, index) => (
            <fieldset className="admin-fields admin-sql-table">
              <legend>Table {index + 1}</legend>
              <Field label="Table name">
                <input
                  value={table.name}
                  onChange={(event) => updateTable(index, { name: event.target.value })}
                />
              </Field>
              <SqlColumns
                label="Input columns"
                columns={table.columns}
                types={inputTypes}
                disabled={disabled}
                onChange={(columns) => updateTable(index, { columns })}
              />
              <button
                type="button"
                className="quiet-button admin-delete-action"
                onClick={() =>
                  onChange({ ...value, tables: tables.filter((_, position) => position !== index) })
                }
              >
                <Trash2 size={16} aria-hidden="true" /> Remove table
              </button>
            </fieldset>
          )}
        />
        <button
          type="button"
          className="button button-secondary"
          ref={addTable}
          disabled={tables.length >= 16}
          onClick={() => onChange({ ...value, tables: [...tables, { name: "", columns: [] }] })}
        >
          Add table
        </button>
      </section>
      <section>
        <h2>Query result</h2>
        <div className="admin-authoring-compact">
          <Field label="Result row order">
            <SelectField
              label="Result row order"
              value={value.outputOrder}
              disabled={disabled}
              options={[
                { value: "unordered", label: "Any order" },
                { value: "ordered", label: "Exact order" },
              ]}
              onChange={(outputOrder) => {
                if (outputOrder === "ordered" || outputOrder === "unordered")
                  onChange({ ...value, outputOrder });
              }}
            />
          </Field>
        </div>
        <SqlColumns
          label="Result columns"
          columns={value.output ?? []}
          types={outputTypes}
          disabled={disabled}
          onChange={(output) => onChange({ ...value, output })}
        />
      </section>
    </>
  );
}
