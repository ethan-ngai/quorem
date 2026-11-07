import { useId, type ReactNode } from "react";
import "./choice-matrix.css";

/** Shared column labels, independent native radio groups per row. */
export function ChoiceMatrix<Row extends string, Value extends string>({
  label,
  columns,
  rows,
  disabled,
  onChange,
}: {
  label: string;
  columns: readonly { value: Value; label: string; icon?: ReactNode }[];
  rows: readonly {
    key: Row;
    label: string;
    icon?: ReactNode;
    value: Value;
    labels?: Partial<Record<Value, string>>;
  }[];
  disabled?: boolean;
  onChange: (row: Row, value: Value) => void;
}) {
  const id = useId();
  return (
    <table className="choice-matrix" aria-label={label}>
      <thead>
        <tr>
          <td />
          {columns.map((column) => (
            <th key={column.value} scope="col">
              <span>
                {column.icon}
                {column.label}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">
              <span>
                {row.icon}
                {row.label}
              </span>
            </th>
            {columns.map((column) => (
              <td key={column.value}>
                <label>
                  <input
                    type="radio"
                    name={id + row.key}
                    checked={row.value === column.value}
                    disabled={disabled}
                    aria-label={row.label + ": " + (row.labels?.[column.value] ?? column.label)}
                    onChange={() => onChange(row.key, column.value)}
                  />
                  <span className="choice-matrix-indicator" aria-hidden="true" />
                </label>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
