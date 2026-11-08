import { TextInput } from "../../../ui/TextControl";
import { useRef } from "react";
import { AnimatedRows } from "../../../ui/AnimatedRows";
import type { QuestionProblem } from "@quorem/contracts";
import { Icon } from "../../../ui/Icon";
import { Tooltip } from "../../../ui/Tooltip";
import {
  parseSqlResult,
  parseSqlSetup,
  sqlCellText,
  sqlCellInputConstraint,
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
  const addRow = useRef<HTMLButtonElement>(null);
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
          <AnimatedRows
            as="tbody"
            items={rows}
            focusFallback={addRow}
            getKey={(row) => JSON.stringify(row)}
            preserveEdits
            renderRow={(row, rowIndex) => (
              <>
                {columns.map((column, columnIndex) => {
                  const value = row[columnIndex];
                  const label = `${name} row ${rowIndex + 1} ${column.name}`;
                  return (
                    <td key={columnIndex}>
                      <div className="sql-cell-editor">
                        {value === null ? (
                          <span className="sql-null motion-reveal">NULL</span>
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
                          <TextInput
                            unstyled
                            constraint={sqlCellInputConstraint(column.type)}
                            aria-label={label}
                            value={sqlCellText(value)}
                            onChange={(event) => setCell(rowIndex, columnIndex, event.target.value)}
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
              </>
            )}
            empty={
              <tr>
                <td className="sql-empty" colSpan={columns.length + 1}>
                  No rows
                </td>
              </tr>
            }
          />
        </table>
      </div>
      <button
        type="button"
        className="quiet-button sql-add-row"
        ref={addRow}
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
  problem: QuestionProblem;
  input: string;
  expected?: string;
  onInputChange: (value: string) => void;
  onExpectedChange: (value: string) => void;
}) {
  try {
    const setup = parseSqlSetup(input);
    const schema = sqlTables(problem, setup);
    const output = expected === undefined ? undefined : parseSqlResult(expected);
    const names = new Set(schema.map(({ name }) => name));
    const resize = (rows: unknown[][], columns: SqlDraftColumn[]) =>
      rows.map((row) =>
        columns.map((column, index) => (index < row.length ? row[index] : sqlDefault(column.type))),
      );
    const outputColumns = output ? sqlOutputColumns(problem, setup, output) : [];
    const outputNeedsSync = output?.rows.some((row) => row.length !== outputColumns.length);
    const needsSync =
      !!problem.sql?.tables?.length &&
      (setup.tables.some(({ name }) => !names.has(name)) ||
        schema.some(({ name, columns }) => {
          const table = setup.tables.find((item) => item.name === name);
          return !table || table.rows.some((row) => row.length !== columns.length);
        }));
    return (
      <>
        <div className="sql-editor-label">Input tables</div>
        {needsSync && (
          <div className="typed-case-field">
            <p>
              Table schema changed. Sync preserves cells by position, adds default values, and
              removes extra cells and tables. Check column values after syncing.
            </p>
            <button
              type="button"
              className="button button-secondary"
              onClick={() =>
                onInputChange(
                  JSON.stringify({
                    tables: schema.map(({ name, columns }) => ({
                      name,
                      rows: resize(
                        setup.tables.find((table) => table.name === name)?.rows ?? [],
                        columns,
                      ),
                    })),
                  }),
                )
              }
            >
              Sync input tables
            </button>
          </div>
        )}
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
        {output && outputNeedsSync && (
          <div className="typed-case-field">
            <p>
              Output columns changed. Sync preserves cells by position, adds defaults, and removes
              extra cells. Check values after syncing.
            </p>
            <button
              type="button"
              className="button button-secondary"
              onClick={() =>
                onExpectedChange(
                  JSON.stringify({ ...output, rows: resize(output.rows, outputColumns) }),
                )
              }
            >
              Sync expected output
            </button>
          </div>
        )}
        {output && (
          <EditableTable
            name="Expected output"
            columns={outputColumns}
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
