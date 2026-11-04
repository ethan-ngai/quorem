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
  function update(index: number, patch: Partial<Column>) {
    onChange(
      columns.map((column, position) => (position === index ? { ...column, ...patch } : column)),
    );
  }
  return (
    <fieldset className="admin-fields admin-sql-columns">
      <legend>{label}</legend>
      {columns.map((column, index) => (
        <div className="admin-sql-column" key={index}>
          <input
            aria-label={`Column ${index + 1} name`}
            placeholder="Column name"
            value={column.name}
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <SelectField
            label={`Column ${index + 1} type`}
            value={column.type}
            disabled={disabled}
            options={types.map((type) => ({ value: type, label: type }))}
            onChange={(value) => {
              const type = types.find((type) => type === value);
              if (type) update(index, { type });
            }}
          />
          <button
            type="button"
            className="quiet-button"
            aria-label={`Remove column ${index + 1}`}
            onClick={() => onChange(columns.filter((_, position) => position !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button button-secondary"
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
        {tables.map((table, index) => (
          <fieldset className="admin-fields admin-sql-table" key={index}>
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
              Remove table
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="button button-secondary"
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
