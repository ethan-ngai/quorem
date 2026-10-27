import type { ProblemVersion } from "@quorem/contracts";
import { Icon } from "../../../ui/Icon";
import { Tooltip } from "../../../ui/Tooltip";
import {
  parseSqlResult,
  parseSqlSetup,
  sqlCellText,
  sqlDefault,
  sqlOutputColumns,
  sqlTables,
  type SqlDraftColumn,
} from "../sqlDraft";
import "./sql-tables.css";

function EditableTable({
  name,
  columns,
  rows,
  onChange,
  maxRows = 200,
}: {
  name: string;
  columns: SqlDraftColumn[];
  rows: unknown[][];
  onChange: (rows: unknown[][]) => void;
  maxRows?: number;
}) {
  function setCell(rowIndex: number, columnIndex: number, value: unknown) {
    onChange(
      rows.map((row, index) =>
        index === rowIndex
          ? row.map((item, position) => (position === columnIndex ? value : item))
          : row,
      ),
    );
  }
  return (
    <div className="sql-table-block">
      <div className="sql-table-label">{name}</div>
      <div className="sql-table-scroll" role="region" aria-label={`${name} table`} tabIndex={0}>
        <table className="sql-table sql-table-editable" aria-label={name}>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={index} scope="col">
                  <span>{column.name}</span>
                  <small>{column.type}</small>
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">Row actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {columns.map((column, columnIndex) => {
                    const value = row[columnIndex];
                    const label = `${name} row ${rowIndex + 1} ${column.name}`;
                    return (
                      <td key={columnIndex}>
                        <div className="sql-cell-editor">
                          {value === null ? (
                            <span className="sql-null">NULL</span>
                          ) : column.type === "boolean" ? (
                            <select
                              aria-label={label}
                              value={sqlCellText(value)}
                              onChange={(event) =>
                                setCell(rowIndex, columnIndex, event.target.value === "true")
                              }
                            >
                              <option value="true">true</option>
                              <option value="false">false</option>
                            </select>
                          ) : (
                            <input
                              aria-label={label}
                              value={sqlCellText(value)}
                              onChange={(event) =>
                                setCell(rowIndex, columnIndex, event.target.value)
                              }
                            />
                          )}
                          <Tooltip content={value === null ? "Set value" : "Set NULL"}>
                            <button
                              type="button"
                              className="sql-null-toggle"
                              aria-label={`${value === null ? "Set value for" : "Set NULL for"} ${label}`}
                              onClick={() =>
                                setCell(
                                  rowIndex,
                                  columnIndex,
                                  value === null ? sqlDefault(column.type) : null,
                                )
                              }
                            >
                              {value === null ? "Value" : "NULL"}
                            </button>
                          </Tooltip>
                        </div>
                      </td>
                    );
                  })}
                  <td>
                    <Tooltip content="Remove row">
                      <button
                        type="button"
                        className="icon-button destructive-icon"
                        aria-label={`Remove ${name} row ${rowIndex + 1}`}
                        onClick={() => onChange(rows.filter((_, index) => index !== rowIndex))}
                      >
                        <Icon name="trash" />
                      </button>
                    </Tooltip>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="sql-empty" colSpan={columns.length + 1}>
                  No rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="quiet-button sql-add-row"
        disabled={rows.length >= maxRows}
        onClick={() => onChange([...rows, columns.map((column) => sqlDefault(column.type))])}
      >
        <Icon name="plus" /> Add row
      </button>
    </div>
  );
}

export function SqlCaseEditor({
  problem,
  input,
  expected,
  onInputChange,
  onExpectedChange,
}: {
  problem: ProblemVersion;
  input: string;
  expected?: string;
  onInputChange: (value: string) => void;
  onExpectedChange: (value: string) => void;
}) {
  try {
    const setup = parseSqlSetup(input);
    const schema = sqlTables(problem, setup);
    const output = expected === undefined ? undefined : parseSqlResult(expected);
    return (
      <>
        <div className="sql-editor-label">Input tables</div>
        <div className="sql-tables">
          {schema.map((table) => {
            const data = setup.tables.find((item) => item.name === table.name);
            if (!data) return null;
            return (
              <EditableTable
                key={table.name}
                name={table.name}
                columns={table.columns}
                rows={data.rows}
                onChange={(rows) =>
                  onInputChange(
                    JSON.stringify({
                      ...setup,
                      tables: setup.tables.map((item) =>
                        item.name === table.name ? { ...item, rows } : item,
                      ),
                    }),
                  )
                }
              />
            );
          })}
        </div>
        {output && (
          <EditableTable
            name="Expected output"
            columns={sqlOutputColumns(problem, setup, output)}
            rows={output.rows}
            maxRows={10000}
            onChange={(rows) => onExpectedChange(JSON.stringify({ ...output, rows }))}
          />
        )}
      </>
    );
  } catch {
    return (
      <p className="typed-case-error">Could not open this case. Remove it and add a new case.</p>
    );
  }
}
